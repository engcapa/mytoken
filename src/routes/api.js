import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';
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

// POST /api/jev/harmonize - trigger Jev model category harmonization across all shops
router.post('/jev/harmonize', async (req, res) => {
  try {
    const { forceAll = false } = req.body || {};
    const result = await jevService.harmonizeAllCategories(shopService, { forceAll: Boolean(forceAll) });
    const categories = shopService.getCategories();
    res.json({
      success: true,
      message: `Jev 智能统一分类已完成！共识别 ${result.totalCategories} 个小铺原始分类，更新 ${result.updatedCount} 条映射。`,
      data: {
        ...result,
        categories
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/jev/categories - get current category mappings & distinct categories
router.get('/jev/categories', (req, res) => {
  try {
    const categories = shopService.getCategories();
    const distinctList = shopService.getDistinctShopCategories();
    const mappings = shopService.getAllCategoryMappings();
    res.json({
      success: true,
      data: {
        categories,
        distinctList,
        mappings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/jev/categories/override - manually override a category mapping
router.post('/jev/categories/override', (req, res) => {
  try {
    const { shopCode, rawCategory, canonicalCategory } = req.body || {};
    if (!shopCode || !rawCategory || !canonicalCategory) {
      return res.status(400).json({ success: false, error: 'shopCode, rawCategory and canonicalCategory are required' });
    }
    const updatedCount = shopService.saveCategoryMapping({
      shopCode: shopCode.trim(),
      rawCategory: rawCategory.trim(),
      canonicalCategory: canonicalCategory.trim(),
      confidence: 1.0,
      source: 'manual'
    });
    res.json({
      success: true,
      message: `已成功将 [${shopCode}] "${rawCategory}" 映射为 "${canonicalCategory}"，同步更新 ${updatedCount} 件商品！`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ip-monitor - get real-time IP unban monitor status
router.get('/ip-monitor', (req, res) => {
  try {
    const statusFile = path.resolve(path.dirname(config.databasePath), 'ip_monitor.json');
    if (!fs.existsSync(statusFile)) {
      return res.json({ success: true, active: false, message: '监控任务未启动或尚无检测记录' });
    }
    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    res.json({ success: true, active: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/system/antiban - get current anti-ban & proxy settings
router.get('/system/antiban', (req, res) => {
  res.json({
    success: true,
    data: {
      antiBanEnabled: config.antiBan.enabled,
      minDelayMs: config.antiBan.minDelayMs,
      maxDelayMs: config.antiBan.maxDelayMs,
      shopDelayMs: config.antiBan.shopDelayMs,
      autoProxyFallback: config.antiBan.autoProxyFallback,
      simulateHumanBehavior: config.antiBan.simulateHumanBehavior,
      globalProxyEnabled: config.proxy.enabled,
      proxyUrl: config.proxy.httpsProxy || config.proxy.httpProxy || config.proxy.allProxy || ''
    }
  });
});

// POST /api/system/antiban - update anti-ban & proxy settings at runtime
router.post('/system/antiban', (req, res) => {
  try {
    const { antiBanEnabled, minDelayMs, maxDelayMs, shopDelayMs, autoProxyFallback, simulateHumanBehavior, globalProxyEnabled, proxyUrl } = req.body || {};
    if (antiBanEnabled !== undefined) config.antiBan.enabled = Boolean(antiBanEnabled);
    if (minDelayMs !== undefined) config.antiBan.minDelayMs = parseInt(minDelayMs, 10);
    if (maxDelayMs !== undefined) config.antiBan.maxDelayMs = parseInt(maxDelayMs, 10);
    if (shopDelayMs !== undefined) config.antiBan.shopDelayMs = parseInt(shopDelayMs, 10);
    if (autoProxyFallback !== undefined) config.antiBan.autoProxyFallback = Boolean(autoProxyFallback);
    if (simulateHumanBehavior !== undefined) config.antiBan.simulateHumanBehavior = Boolean(simulateHumanBehavior);
    if (globalProxyEnabled !== undefined) config.proxy.enabled = Boolean(globalProxyEnabled);
    if (proxyUrl !== undefined) {
      config.proxy.httpsProxy = proxyUrl;
      config.proxy.httpProxy = proxyUrl;
      config.proxy.allProxy = proxyUrl;
    }
    res.json({
      success: true,
      message: '防封与拟人化策略设置已实时生效！',
      data: {
        antiBanEnabled: config.antiBan.enabled,
        minDelayMs: config.antiBan.minDelayMs,
        maxDelayMs: config.antiBan.maxDelayMs,
        shopDelayMs: config.antiBan.shopDelayMs,
        autoProxyFallback: config.antiBan.autoProxyFallback,
        simulateHumanBehavior: config.antiBan.simulateHumanBehavior,
        globalProxyEnabled: config.proxy.enabled,
        proxyUrl: config.proxy.httpsProxy || config.proxy.httpProxy || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
