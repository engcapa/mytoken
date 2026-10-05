import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import config from '../config/index.js';
import { shopService, logService } from './db.js';

function getBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.CHROME_PATH,
    process.env.BROWSER_PATH
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Scraper service for wzyp.cn and general shop websites
 * Supports both fast HTTP mode and interactive browser verification mode
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
      validateStatus: () => true
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
      html.includes('阿里云ESA') ||
      html.includes('aliyunCaptcha')
    );
  }

  /**
   * Parse HTML content into structured shop / goods records
   */
  parseShops(html, baseUrl) {
    const $ = cheerio.load(html);
    const shops = [];

    // Extract shop-level info if this is a single shop page like /shop/FT7
    const shopHeaderTitle = $('.shop-name, .shop-title, h1, .header-title, .navbar-brand').first().text().trim();
    const shopNotice = $('.notice, .announcement, .bulletin, .alert, .shop-desc').first().text().trim();
    const shopContact = $('.contact, .qq, .wechat, .phone, .service-contact').first().text().trim();

    // Check for goods items, table rows, cards
    const selectors = [
      '.goods-item',
      '.goods-card',
      '.product-item',
      '.van-card',
      '.goods-box',
      '.shop-item',
      '.shop-card',
      '.store-item',
      '.item-card',
      '.list-item',
      'table tbody tr',
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
        const title = item.find('h1, h2, h3, h4, .title, .name, .goods-name, .goods-title, td.name, td.title').first().text().trim() ||
                      item.find('a').first().text().trim();
        if (!title || title.length < 2) return;

        const link = item.find('a').attr('href') || '';
        const fullUrl = link ? new URL(link, baseUrl).href : baseUrl;
        const img = item.find('img').first().attr('src') || '';
        const fullImg = img ? new URL(img, baseUrl).href : '';

        const desc = item.find('.desc, .description, .intro, .detail, p, td.desc').first().text().trim() || shopNotice;
        const price = item.find('.price, .cost, .tag-price, .goods-price, td.price').first().text().trim();
        const category = item.find('.category, .tag, .badge, .van-tag, td.category').first().text().trim() ||
                         (shopHeaderTitle ? `${shopHeaderTitle}` : 'General');
        const contact = item.find('.contact, .phone, .wechat, .author').first().text().trim() || shopContact;
        const address = item.find('.address, .location').first().text().trim() || baseUrl;

        // Stock status if available
        const stock = item.find('.stock, .inventory, .badge-stock, td.stock').first().text().trim();
        const displayDesc = stock ? `[Stock: ${stock}] ${desc}` : desc;

        shops.push({
          externalId: fullUrl !== baseUrl ? `${fullUrl}_${index}` : `item_${index}_${encodeURIComponent(title.substring(0, 30))}`,
          title,
          category,
          description: displayDesc,
          price,
          contact,
          address,
          sourceUrl: fullUrl,
          images: fullImg ? [fullImg] : [],
          rawData: {
            selectorUsed: foundItems.sel,
            shopTitle: shopHeaderTitle,
            extractedAt: new Date().toISOString()
          }
        });
      });
    } else {
      // Fallback: search for anchor tags that might represent goods or shop links
      $('a').each((index, el) => {
        const a = $(el);
        const text = a.text().trim();
        const href = a.attr('href');

        if (text && text.length > 3 && text.length < 80 && href && !href.startsWith('javascript:')) {
          try {
            const fullUrl = new URL(href, baseUrl).href;
            if (
              href.includes('shop') ||
              href.includes('item') ||
              href.includes('goods') ||
              href.includes('detail') ||
              href.includes('product')
            ) {
              shops.push({
                externalId: fullUrl,
                title: text,
                category: shopHeaderTitle || 'Featured Items',
                description: a.attr('title') || shopNotice || '',
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
   * Run standard HTTP scraping
   */
  async run({ url = this.targetUrl, cookie = this.cookie } = {}) {
    const target = url || this.targetUrl;
    try {
      const response = await this.fetchHtml(target, cookie);

      if (this.isWafChallenge(response.data)) {
        const errorMsg = 'Target site triggered Alibaba Cloud ESA slide captcha (WAF). Interactive browser verification is available.';
        logService.addLog({
          targetUrl: target,
          status: 'WAF_BLOCKED',
          itemsScraped: 0,
          message: errorMsg
        });

        return {
          success: false,
          wafBlocked: true,
          canInteractive: true,
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
   * Run interactive scraping with visible desktop browser (Chrome/Edge)
   * The user can slide the captcha directly on their screen, and the scraper automatically captures cookies and products!
   */
  async runInteractive({ url = this.targetUrl } = {}) {
    const target = url || this.targetUrl;
    const browserPath = getBrowserPath();
    if (!browserPath) {
      return {
        success: false,
        message: 'No Chrome or Edge browser executable found on system.'
      };
    }

    let browser = null;
    try {
      console.log(`[Interactive Scraper] Launching browser: ${browserPath}`);
      browser = await puppeteer.launch({
        executablePath: browserPath,
        headless: false, // Visible window on user's desktop!
        defaultViewport: null,
        args: [
          '--window-size=1200,800',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      await page.setUserAgent(this.userAgent);

      console.log(`[Interactive Scraper] Navigating to: ${target}`);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Poll page for up to 90 seconds waiting for user to pass the captcha
      const maxWaitMs = 90000;
      const startTime = Date.now();
      let solved = false;

      while (Date.now() - startTime < maxWaitMs) {
        const content = await page.content();
        if (!this.isWafChallenge(content)) {
          solved = true;
          break;
        }
        await new Promise(r => setTimeout(r, 1200));
      }

      if (!solved) {
        await browser.close();
        return {
          success: false,
          wafBlocked: true,
          message: 'Timeout waiting for manual verification slider to be completed.'
        };
      }

      // Wait a moment for dynamic shop items to render
      await new Promise(r => setTimeout(r, 2500));

      // Extract fresh session cookies
      const cookies = await page.cookies();
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      if (cookieHeader) {
        this.cookie = cookieHeader;
      }

      // Extract fully rendered HTML
      const renderedHtml = await page.content();
      await browser.close();

      const shops = this.parseShops(renderedHtml, target);
      const savedCount = shopService.upsertBatch(shops);

      const message = `Interactive scrape successful! Saved ${savedCount} records. Captured fresh session Cookie.`;
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
        cookie: cookieHeader,
        items: shops
      };
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch {}
      }
      const message = `Interactive scrape error: ${err.message}`;
      logService.addLog({
        targetUrl: target,
        status: 'FAILED',
        itemsScraped: 0,
        message
      });
      return {
        success: false,
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
        externalId: 'sample_wzyp_FT7_001',
        title: '【官方充值】Claude 3.5 Sonnet / Opus 独享会员号',
        category: 'Claude专区',
        description: '[Stock: In Stock] 独享原生IP注册账号，带原始邮箱，已升级Pro订阅，支持官方最新Claude 3.5 Sonnet模型。',
        price: '¥ 145.00',
        contact: '微信: ai_service_01',
        address: 'wzyp.cn/shop/FT7 (链动小铺)',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', shop: 'FT7', rating: 5.0, sales: 820 }
      },
      {
        externalId: 'sample_wzyp_FT7_002',
        title: '【自动发卡】ChatGPT Plus 官方代充 (支持续费)',
        category: 'ChatGPT专区',
        description: '[Stock: In Stock] 官方正规Stripe支付，提供订阅收据，杜绝黑卡封号，支持自备号升级或新号交付。',
        price: '¥ 158.00',
        contact: '微信: ai_service_01',
        address: 'wzyp.cn/shop/FT7 (链动小铺)',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1677442136019-21780efad99a?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', shop: 'FT7', rating: 4.9, sales: 1290 }
      },
      {
        externalId: 'sample_wzyp_FT7_003',
        title: 'Cursor Pro 专业版 IDE 会员代充 (月付/年付)',
        category: '开发者工具',
        description: '[Stock: In Stock] 全球最受欢迎的 AI 代码编辑器会员，支持 GPT-4o 及 Claude 3.5 无限制高级代码补全。',
        price: '¥ 140.00',
        contact: 'QQ: 77777777',
        address: 'wzyp.cn/shop/FT7 (链动小铺)',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', shop: 'FT7', rating: 5.0, sales: 640 }
      },
      {
        externalId: 'sample_wzyp_FT7_004',
        title: '【官方额度】OpenAI API 500$ 开发者独立中转 Key',
        category: 'API额度专区',
        description: '[Stock: In Stock] 高并发、国内直连极速响应，支持 gpt-4o、gpt-4-turbo 等全系模型，无封号风险。',
        price: '¥ 88.00 起',
        contact: 'TG: @wzyp_ft7_support',
        address: 'wzyp.cn/shop/FT7 (链动小铺)',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=500&auto=format&fit=crop'],
        rawData: { source: 'sample', shop: 'FT7', rating: 4.8, sales: 980 }
      }
    ];

    return shopService.upsertBatch(samples);
  }
}

export const scraperService = new ScraperService();
