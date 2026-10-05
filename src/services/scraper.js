import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config/index.js';
import { shopService, logService } from './db.js';

/**
 * Scraper service for wzyp.cn and general shop websites
 */
export class ScraperService {
  constructor(options = {}) {
    this.targetUrl = options.targetUrl || config.targetUrl;
    this.userAgent = options.userAgent || config.userAgent;
    this.cookie = options.cookie || config.wafCookie;
  }

  /**
   * Perform HTTP fetch with browser-like headers
   */
  async fetchHtml(url, customCookie = '') {
    const cookie = customCookie || this.cookie;
    const headers = {
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1'
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const response = await axios.get(url, {
      headers,
      timeout: 15000,
      validateStatus: () => true // Handle all status codes manually
    });

    return {
      status: response.status,
      headers: response.headers,
      data: response.data
    };
  }

  /**
   * Detect Alibaba Cloud ESA WAF slide captcha challenge
   */
  isWafChallenge(html) {
    if (typeof html !== 'string') return false;
    return (
      html.includes('AliyunCaptcha') ||
      html.includes('滑动验证页面') ||
      html.includes('CF_APP_WAF') ||
      html.includes('阿里云ESA')
    );
  }

  /**
   * Parse HTML content into structured shop records
   */
  parseShops(html, baseUrl) {
    const $ = cheerio.load(html);
    const shops = [];

    // Try common shop item selectors
    const selectors = [
      '.shop-item',
      '.shop-card',
      '.store-item',
      '.goods-item',
      '.item-card',
      '.list-item',
      'article',
      '.card'
    ];

    let foundItems = null;
    for (const sel of selectors) {
      const elements = $(sel);
      if (elements.length > 0) {
        foundItems = { sel, elements };
        break;
      }
    }

    if (foundItems && foundItems.elements.length > 0) {
      foundItems.elements.each((index, el) => {
        const item = $(el);
        const title = item.find('h1, h2, h3, h4, .title, .name, .shop-name').first().text().trim() ||
                      item.find('a').first().text().trim();
        if (!title) return;

        const link = item.find('a').attr('href') || '';
        const fullUrl = link ? new URL(link, baseUrl).href : baseUrl;
        const img = item.find('img').first().attr('src') || '';
        const fullImg = img ? new URL(img, baseUrl).href : '';

        const desc = item.find('.desc, .description, .intro, p').first().text().trim();
        const price = item.find('.price, .cost, .tag-price').first().text().trim();
        const category = item.find('.category, .tag, .badge').first().text().trim() || 'General';
        const contact = item.find('.contact, .phone, .wechat, .author').first().text().trim();
        const address = item.find('.address, .location').first().text().trim();

        shops.push({
          externalId: fullUrl !== baseUrl ? fullUrl : `wzyp_${index}_${Date.now()}`,
          title,
          category,
          description: desc,
          price,
          contact,
          address,
          sourceUrl: fullUrl,
          images: fullImg ? [fullImg] : [],
          rawData: {
            selectorUsed: foundItems.sel,
            extractedAt: new Date().toISOString()
          }
        });
      });
    } else {
      // Fallback: search for anchor tags that might represent shop or listing entries
      $('a').each((index, el) => {
        const a = $(el);
        const text = a.text().trim();
        const href = a.attr('href');

        if (text && text.length > 3 && text.length < 50 && href && !href.startsWith('javascript:')) {
          try {
            const fullUrl = new URL(href, baseUrl).href;
            if (
              href.includes('shop') ||
              href.includes('store') ||
              href.includes('item') ||
              href.includes('detail') ||
              href.includes('p/')
            ) {
              shops.push({
                externalId: fullUrl,
                title: text,
                category: 'Featured',
                description: a.attr('title') || '',
                sourceUrl: fullUrl,
                images: [],
                rawData: {
                  type: 'anchor_fallback',
                  extractedAt: new Date().toISOString()
                }
              });
            }
          } catch {
            // Ignore invalid URL
          }
        }
      });
    }

    return shops;
  }

  /**
   * Run the scraping process
   */
  async run({ url = this.targetUrl, cookie = this.cookie } = {}) {
    const target = url || this.targetUrl;
    try {
      const response = await this.fetchHtml(target, cookie);

      if (this.isWafChallenge(response.data)) {
        const errorMsg = 'Target site triggered Alibaba Cloud ESA slide captcha (WAF). Please complete the captcha in your browser and provide the session Cookie to continue.';
        logService.addLog({
          targetUrl: target,
          status: 'WAF_BLOCKED',
          itemsScraped: 0,
          message: errorMsg
        });

        return {
          success: false,
          wafBlocked: true,
          message: errorMsg,
          count: 0
        };
      }

      if (response.status >= 400) {
        const errorMsg = `HTTP request failed with status code: ${response.status}`;
        logService.addLog({
          targetUrl: target,
          status: 'FAILED',
          itemsScraped: 0,
          message: errorMsg
        });

        return {
          success: false,
          wafBlocked: false,
          message: errorMsg,
          count: 0
        };
      }

      const shops = this.parseShops(response.data, target);
      const savedCount = shopService.upsertBatch(shops);

      const message = `Scrape successful! Parsed ${shops.length} items, saved ${savedCount} records.`;
      logService.addLog({
        targetUrl: target,
        status: 'SUCCESS',
        itemsScraped: savedCount,
        message
      });

      return {
        success: true,
        wafBlocked: false,
        message,
        count: savedCount,
        items: shops
      };
    } catch (err) {
      const message = `Scraper error: ${err.message}`;
      logService.addLog({
        targetUrl: target,
        status: 'FAILED',
        itemsScraped: 0,
        message
      });

      return {
        success: false,
        wafBlocked: false,
        message,
        count: 0
      };
    }
  }

  /**
   * Seed realistic sample shop data for demonstration
   */
  static seedSampleData() {
    const samples = [
      {
        externalId: 'sample_wzyp_001',
        title: 'Tech & Code Digital Store',
        category: 'Digital Goods',
        description: 'High-quality website templates, web scraping scripts, enterprise Node.js project boilerplates, and technical documentation.',
        price: '$19.99 - $99.00',
        contact: 'Email: support@techstore.io',
        address: 'Instant Digital Delivery',
        sourceUrl: 'https://wzyp.cn/shop/101',
        images: ['https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', rating: 4.9, sales: 520 }
      },
      {
        externalId: 'sample_wzyp_002',
        title: 'Artisan Gourmet & Local Specialities',
        category: 'Food & Dining',
        description: 'Authentic local delicacies, organic handcrafted snacks, specialty tea, and fresh farm products with express shipping.',
        price: 'From $15.00',
        contact: 'Phone: +86-138-0000-8888',
        address: 'Wuma Commercial Street, Lucheng District, Wenzhou',
        sourceUrl: 'https://wzyp.cn/shop/102',
        images: ['https://images.unsplash.com/photo-1534452203293-494d7ddbf7e0?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', rating: 4.8, sales: 1340 }
      },
      {
        externalId: 'sample_wzyp_003',
        title: 'Geek Hardware & Peripheral Studio',
        category: 'Electronics',
        description: 'Custom mechanical keyboard cases, open-source microcontrollers, dev kits, braided cables, and ergonomic accessories.',
        price: '$12.00 - $189.00',
        contact: 'Discord: @geek_studio',
        address: 'Online & Electronic Marketplace Counter',
        sourceUrl: 'https://wzyp.cn/shop/103',
        images: ['https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', rating: 5.0, sales: 860 }
      },
      {
        externalId: 'sample_wzyp_004',
        title: 'Nordic Ceramic & Handmade Crafts',
        category: 'Creative Arts',
        description: 'Handmade ceramic mugs, minimalist home decor, original illustration prints, and leather-bound journals.',
        price: 'From $25.00',
        contact: 'Instagram: @nordic_craft_hub',
        address: 'Innovation Park, University Town, Ouhai',
        sourceUrl: 'https://wzyp.cn/shop/104',
        images: ['https://images.unsplash.com/photo-1456086272160-b28b0645b729?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', rating: 4.9, sales: 430 }
      },
      {
        externalId: 'sample_wzyp_005',
        title: 'Starry Bakery & Cold Brew Cafe',
        category: 'Bakery & Cafe',
        description: 'Artisanal cold brew coffees, French pastries, low-sugar sourdough bread, and seasonal dessert gift boxes.',
        price: '$6.50 - $48.00',
        contact: 'WhatsApp: +86-139-1111-2222',
        address: 'No. 88 Xueyuan Middle Road',
        sourceUrl: 'https://wzyp.cn/shop/105',
        images: ['https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', rating: 4.7, sales: 2190 }
      }
    ];

    return shopService.upsertBatch(samples);
  }
}

export const scraperService = new ScraperService();
