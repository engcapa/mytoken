import { Router } from 'express';
import { shopService, logService } from '../services/db.js';
import { scraperService, ScraperService } from '../services/scraper.js';

const router = Router();

// GET /api/shops - list shops with pagination & search
router.get('/shops', (req, res) => {
  try {
    const { search = '', category = '', page = '1', limit = '12' } = req.query;
    const result = shopService.getShops({
      search: String(search),
      category: String(category),
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 12
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

// POST /api/shops - add or update shop manually
router.post('/shops', (req, res) => {
  try {
    const { title, category, description, price, contact, address, sourceUrl, images } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Shop title is required' });
    }
    const externalId = shopService.upsertShop({
      title: title.trim(),
      category: category?.trim() || 'General',
      description,
      price,
      contact,
      address,
      sourceUrl,
      images: Array.isArray(images) ? images : []
    });
    res.json({ success: true, message: 'Shop saved successfully', id: externalId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/shops/:id - delete shop
router.delete('/shops/:id', (req, res) => {
  try {
    shopService.deleteShop(req.params.id);
    res.json({ success: true, message: 'Shop deleted successfully' });
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

// POST /api/scrape - trigger scraper (supports fast HTTP or interactive browser mode)
router.post('/scrape', async (req, res) => {
  try {
    const { url, cookie, interactive = false } = req.body;
    let result;
    if (interactive) {
      result = await scraperService.runInteractive({ url });
    } else {
      result = await scraperService.run({ url, cookie });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/seed - seed sample shops for testing UI
router.post('/seed', (req, res) => {
  try {
    const count = ScraperService.seedSampleData();
    res.json({ success: true, message: `Successfully seeded ${count} sample shops!`, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
