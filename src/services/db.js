import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';

// Ensure data folder exists
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(config.databasePath);

// Initialize database schema with multi-shop, numeric price and in-stock support
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      description TEXT,
      price TEXT,
      price_num REAL DEFAULT 0,
      in_stock INTEGER DEFAULT 1,
      stock_text TEXT DEFAULT '有货',
      shop_code TEXT DEFAULT '',
      contact TEXT,
      address TEXT,
      source_url TEXT,
      images TEXT, -- JSON string array
      raw_data TEXT, -- JSON string object
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scrape_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_url TEXT,
      status TEXT, -- 'SUCCESS', 'FAILED', 'WAF_BLOCKED'
      items_scraped INTEGER DEFAULT 0,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safely check & alter table for existing database instances
  try {
    const tableInfo = db.prepare('PRAGMA table_info(shops)').all();
    const existingCols = new Set(tableInfo.map(c => c.name));
    if (!existingCols.has('price_num')) {
      db.exec('ALTER TABLE shops ADD COLUMN price_num REAL DEFAULT 0');
    }
    if (!existingCols.has('in_stock')) {
      db.exec('ALTER TABLE shops ADD COLUMN in_stock INTEGER DEFAULT 1');
    }
    if (!existingCols.has('stock_text')) {
      db.exec("ALTER TABLE shops ADD COLUMN stock_text TEXT DEFAULT '有货'");
    }
    if (!existingCols.has('shop_code')) {
      db.exec("ALTER TABLE shops ADD COLUMN shop_code TEXT DEFAULT ''");
    }
  } catch (err) {
    console.error('Database migration note:', err.message);
  }

  // Create indexes after columns are guaranteed to exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shops_external_id ON shops(external_id);
    CREATE INDEX IF NOT EXISTS idx_shops_category ON shops(category);
    CREATE INDEX IF NOT EXISTS idx_shops_price_num ON shops(price_num);
    CREATE INDEX IF NOT EXISTS idx_shops_in_stock ON shops(in_stock);
    CREATE INDEX IF NOT EXISTS idx_shops_shop_code ON shops(shop_code);
    CREATE INDEX IF NOT EXISTS idx_shops_created_at ON shops(created_at);
  `);
}

// Ensure database tables on import
initDatabase();

export const shopService = {
  getShops({ search = '', category = '', shopCode = '', inStockOnly = true, sortBy = 'price_asc', page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Filter in-stock only by default
    if (inStockOnly) {
      conditions.push('in_stock = 1');
    }

    if (search && search.trim()) {
      conditions.push('(title LIKE ? OR description LIKE ? OR contact LIKE ? OR address LIKE ? OR shop_code LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    if (category && category.trim() && category !== 'All' && category !== '全部') {
      conditions.push('category = ?');
      params.push(category.trim());
    }

    if (shopCode && shopCode.trim() && shopCode !== 'All' && shopCode !== '全部') {
      conditions.push('shop_code = ?');
      params.push(shopCode.trim());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total query
    const countSql = `SELECT COUNT(*) as total FROM shops ${whereClause}`;
    const countStmt = db.prepare(countSql);
    const countRes = countStmt.all(...params);
    const total = countRes[0]?.total || 0;

    // Sorting: Grouped by category, sorted by price from low to high
    let orderByClause = 'ORDER BY category ASC, price_num ASC, id DESC';
    if (sortBy === 'price_desc') {
      orderByClause = 'ORDER BY category ASC, price_num DESC, id DESC';
    } else if (sortBy === 'time_desc') {
      orderByClause = 'ORDER BY updated_at DESC, id DESC';
    }

    const dataSql = `
      SELECT * FROM shops
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `;
    const dataStmt = db.prepare(dataSql);
    const items = dataStmt.all(...params, limit, offset);

    return {
      items: items.map(item => ({
        ...item,
        images: item.images ? JSON.parse(item.images) : [],
        raw_data: item.raw_data ? JSON.parse(item.raw_data) : {}
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  },

  getShopById(id) {
    const stmt = db.prepare('SELECT * FROM shops WHERE id = ?');
    const item = stmt.get(Number(id));
    if (!item) return null;
    return {
      ...item,
      images: item.images ? JSON.parse(item.images) : [],
      raw_data: item.raw_data ? JSON.parse(item.raw_data) : {}
    };
  },

  upsertShop(shop) {
    const imagesJson = Array.isArray(shop.images) ? JSON.stringify(shop.images) : (shop.images || '[]');
    const rawDataJson = typeof shop.rawData === 'object' ? JSON.stringify(shop.rawData) : (shop.rawData || '{}');
    const externalId = shop.externalId || shop.sourceUrl || `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // Parse numeric price for sorting
    let priceNum = 0;
    if (typeof shop.priceNum === 'number') {
      priceNum = shop.priceNum;
    } else if (shop.price) {
      const match = String(shop.price).match(/\d+(\.\d+)?/);
      priceNum = match ? parseFloat(match[0]) : 0;
    }

    // Determine stock status
    const inStock = shop.inStock === undefined ? 1 : (shop.inStock ? 1 : 0);
    const stockText = shop.stockText || (inStock ? '有货' : '缺货');
    const shopCode = shop.shopCode || '';

    const stmt = db.prepare(`
      INSERT INTO shops (
        external_id, title, category, description, price, price_num, in_stock, stock_text, shop_code, contact, address, source_url, images, raw_data, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(external_id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        description = excluded.description,
        price = excluded.price,
        price_num = excluded.price_num,
        in_stock = excluded.in_stock,
        stock_text = excluded.stock_text,
        shop_code = excluded.shop_code,
        contact = excluded.contact,
        address = excluded.address,
        source_url = excluded.source_url,
        images = excluded.images,
        raw_data = excluded.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      externalId,
      shop.title || 'Untitled Product',
      shop.category || 'General',
      shop.description || '',
      shop.price || '',
      priceNum,
      inStock,
      stockText,
      shopCode,
      shop.contact || '',
      shop.address || '',
      shop.sourceUrl || '',
      imagesJson,
      rawDataJson
    );

    return externalId;
  },

  upsertBatch(shops = []) {
    let saved = 0;
    for (const shop of shops) {
      if (shop.title) {
        this.upsertShop(shop);
        saved++;
      }
    }
    return saved;
  },

  deleteShop(id) {
    const stmt = db.prepare('DELETE FROM shops WHERE id = ?');
    return stmt.run(Number(id));
  },

  getCategories() {
    const stmt = db.prepare(`
      SELECT DISTINCT category, COUNT(*) as count 
      FROM shops 
      WHERE category IS NOT NULL AND category != '' 
      GROUP BY category 
      ORDER BY count DESC
    `);
    return stmt.all();
  },

  getShopCodes() {
    const stmt = db.prepare(`
      SELECT DISTINCT shop_code, COUNT(*) as count 
      FROM shops 
      WHERE shop_code IS NOT NULL AND shop_code != '' 
      GROUP BY shop_code 
      ORDER BY count DESC
    `);
    return stmt.all();
  },

  getStats() {
    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM shops');
    const total = totalStmt.get()?.total || 0;

    const inStockStmt = db.prepare('SELECT COUNT(*) as total FROM shops WHERE in_stock = 1');
    const inStockCount = inStockStmt.get()?.total || 0;

    const catStmt = db.prepare('SELECT COUNT(DISTINCT category) as count FROM shops');
    const categoriesCount = catStmt.get()?.count || 0;

    const shopCountStmt = db.prepare("SELECT COUNT(DISTINCT shop_code) as count FROM shops WHERE shop_code != ''");
    const shopCodesCount = shopCountStmt.get()?.count || 0;

    const lastLogStmt = db.prepare('SELECT * FROM scrape_logs ORDER BY id DESC LIMIT 1');
    const lastLog = lastLogStmt.get() || null;

    return {
      totalShops: total,
      inStockCount,
      categoriesCount,
      shopCodesCount,
      lastScrape: lastLog
    };
  }
};

export const logService = {
  addLog({ targetUrl, status, itemsScraped = 0, message = '' }) {
    const stmt = db.prepare(`
      INSERT INTO scrape_logs (target_url, status, items_scraped, message)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(targetUrl, status, itemsScraped, message);
  },

  getRecentLogs(limit = 10) {
    const stmt = db.prepare(`
      SELECT * FROM scrape_logs
      ORDER BY id DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }
};
