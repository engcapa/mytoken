import { Router } from 'express';
import { shopService, logService } from '../services/db.js';
import { scraperService, ScraperService } from '../services/scraper.js';
import { jevService } from '../services/jev.js';

const router = Router();

// GET /api/shops - list products (grouped/sorted by category, price asc, in-stock default)
router.get('/shops', (req, res) => {
  try {
    const {
      search = '',
      category = '',
      shopCode = '',
      inStockOnly = 'true',
      sortBy = 'price_asc',
      page = '1',
      limit = '100'
    } = req.query;

    const result = shopService.getShops({
      search: String(search),
      category: String(category),
      shopCode: String(shopCode),
      inStockOnly: inStockOnly !== 'false',
      sortBy: String(sortBy),
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 100
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/shops/:id - single shop details
router.get('/shops/:id', (req, res) => {
  try {
    const shop = shopService.getShopById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, error: 'Shop not found' });
    }
    res.json({ success: true, data: shop });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/shops - add or update shop/product manually
router.post('/shops', (req, res) => {
  try {
    const { title, category, description, price, priceNum, inStock, stockText, shopCode, contact, address, sourceUrl, images } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    const externalId = shopService.upsertShop({
      title: title.trim(),
      category: category?.trim() || 'General',
      description,
      price,
      priceNum,
      inStock: inStock !== undefined ? inStock : 1,
      stockText,
      shopCode,
      contact,
      address,
      sourceUrl,
      images: Array.isArray(images) ? images : []
    });
    res.json({ success: true, message: 'Saved successfully', id: externalId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/shops/:id - delete product
router.delete('/shops/:id', (req, res) => {
  try {
    shopService.deleteShop(req.params.id);
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/categories - get all categories
router.get('/categories', (req, res) => {
  try {
    const categories = shopService.getCategories();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/shop-codes - get distinct shop codes
router.get('/shop-codes', (req, res) => {
  try {
    const codes = shopService.getShopCodes();
    res.json({ success: true, data: codes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stats - dashboard statistics
router.get('/stats', (req, res) => {
  try {
    const stats = shopService.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/logs - scraper logs
router.get('/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 15;
    const logs = logService.getRecentLogs(limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/scrape - trigger scraper (supports fast HTTP or interactive browser mode, single or multiple shops)
router.post('/scrape', async (req, res) => {
  try {
    const { url, urls, cookie, interactive = false } = req.body;
    let result;
    if (interactive) {
      result = await scraperService.runInteractive({ url, urls });
    } else {
      result = await scraperService.run({ url, urls, cookie });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/seed - seed sample shops/goods for testing UI
router.post('/seed', (req, res) => {
  try {
    const count = ScraperService.seedSampleData();
    res.json({ success: true, message: `Successfully seeded ${count} sample items across multiple shops!`, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/jev/config - get current Jev & proxy configuration status
router.get('/jev/config', (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: jevService.enabled,
      hasKey: Boolean(jevService.apiKey),
      maskedKey: jevService.apiKey ? `${jevService.apiKey.slice(0, 4)}...${jevService.apiKey.slice(-4)}` : '',
      baseUrl: jevService.baseUrl,
      model: jevService.model,
      useProxy: jevService.useProxy,
      proxyUrl: jevService.proxyUrl
    }
  });
});

// POST /api/jev/config - update Jev & proxy configuration
router.post('/jev/config', (req, res) => {
  try {
    const { enabled, apiKey, baseUrl, model, useProxy, proxyUrl } = req.body;
    jevService.updateConfig({ enabled, apiKey, baseUrl, model, useProxy, proxyUrl });
    res.json({
      success: true,
      message: 'Jev 与代理配置已生效！',
      data: {
        enabled: jevService.enabled,
        hasKey: Boolean(jevService.apiKey),
        baseUrl: jevService.baseUrl,
        model: jevService.model,
        useProxy: jevService.useProxy,
        proxyUrl: jevService.proxyUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/jev/test - test connection to TypeSafe Jev System One API
router.post('/jev/test', async (req, res) => {
  try {
    const { apiKey, baseUrl, proxyUrl, useProxy } = req.body || {};
    const result = await jevService.testConnection({ apiKey, baseUrl, proxyUrl, useProxy });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: `Jev 连接异常: ${err.message}` });
  }
});

export default router;
