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
 * Extract shop code identifier from a URL (e.g. https://wzyp.cn/shop/FT7 -> FT7)
 */
export function extractShopCode(urlStr = '') {
  if (!urlStr) return '';
  const match = urlStr.match(/\/shop\/([a-zA-Z0-9_-]+)/i);
  if (match) return match[1].toUpperCase();
  try {
    const parsed = new URL(urlStr);
    return parsed.pathname.replace(/^\//, '').replace(/\//g, '_') || parsed.hostname;
  } catch {
    return urlStr.replace(/[^a-zA-Z0-9_-]/g, '');
  }
}

/**
 * Extract numeric price for accurate sorting (e.g. "¥ 145.00 起" -> 145)
 */
export function parseNumericPrice(priceStr = '') {
  if (!priceStr) return 0;
  const match = String(priceStr).replace(/,/g, '').match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

/**
 * Determine whether a product is in stock
 */
export function parseStockStatus(text = '', raw = '') {
  const combined = `${text} ${raw}`.toLowerCase();
  if (
    combined.includes('缺货') ||
    combined.includes('无货') ||
    combined.includes('售罄') ||
    combined.includes('已下架') ||
    combined.includes('库存: 0') ||
    combined.includes('库存:0') ||
    combined.includes('库存 0') ||
    combined.includes('out of stock') ||
    combined.includes('sold out')
  ) {
    return { inStock: 0, stockText: '缺货' };
  }

  // Extract explicit stock count if present
  const countMatch = combined.match(/库存[:：\s]*(\d+)/i);
  if (countMatch && parseInt(countMatch[1], 10) === 0) {
    return { inStock: 0, stockText: '缺货' };
  } else if (countMatch) {
    return { inStock: 1, stockText: `库存 ${countMatch[1]}` };
  }

  return { inStock: 1, stockText: '有货' };
}

/**
 * Scraper service for multi-shop wzyp.cn product extraction
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
    const shopCode = extractShopCode(baseUrl);

    // Extract shop-level info
    const shopHeaderTitle = $('.shop-name, .shop-title, h1, .header-title, .navbar-brand').first().text().trim() ||
                            (shopCode ? `小铺 ${shopCode}` : 'wzyp小铺');
    const shopNotice = $('.notice, .announcement, .bulletin, .alert, .shop-desc').first().text().trim();
    const shopContact = $('.contact, .qq, .wechat, .phone, .service-contact').first().text().trim();

    // Check for goods items, table rows, cards
    const selectors = [
      '.goods-item',
      '.goods-card',
      '.product-item',
      '.van-card',
      '.goods-box',
      '.goods-row',
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
        const priceNum = parseNumericPrice(price);

        const category = item.find('.category, .tag, .badge, .van-tag, td.category').first().text().trim() ||
                         (shopHeaderTitle || '综合专区');
        const contact = item.find('.contact, .phone, .wechat, .author').first().text().trim() || shopContact;
        const address = item.find('.address, .location').first().text().trim() || baseUrl;

        // Stock status
        const rawStockText = item.find('.stock, .inventory, .badge-stock, td.stock').first().text().trim();
        const { inStock, stockText } = parseStockStatus(rawStockText, item.text());

        shops.push({
          externalId: fullUrl !== baseUrl ? `${fullUrl}_${index}` : `item_${shopCode}_${index}_${encodeURIComponent(title.substring(0, 30))}`,
          title,
          category,
          description: desc,
          price,
          priceNum,
          inStock,
          stockText,
          shopCode,
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
      // Fallback: search for anchor tags
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
              const { inStock, stockText } = parseStockStatus(a.text(), a.parent().text());
              shops.push({
                externalId: fullUrl,
                title: text,
                category: shopHeaderTitle || '综合专区',
                description: a.attr('title') || shopNotice || '',
                price: '',
                priceNum: 0,
                inStock,
                stockText,
                shopCode,
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
   * Run standard HTTP scraping for a single shop URL
   */
  async runSingle({ url = this.targetUrl, cookie = this.cookie } = {}) {
    const target = url || this.targetUrl;
    try {
      const response = await this.fetchHtml(target, cookie);

      if (this.isWafChallenge(response.data)) {
        const errorMsg = `[${extractShopCode(target)}] 触发了阿里云ESA滑动验证保护 (WAF)。`;
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
        const errorMsg = `[${extractShopCode(target)}] 请求失败，状态码: ${response.status}`;
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

      const message = `[${extractShopCode(target)}] 抓取成功！解析到 ${shops.length} 条商品，保存 ${savedCount} 条。`;
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
      const message = `[${extractShopCode(target)}] 抓取异常: ${err.message}`;
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
   * Run scraping across multiple shops (batch support)
   */
  async run({ url, urls, cookie = this.cookie } = {}) {
    const targetList = this.normalizeUrlList(urls || url || this.targetUrl);

    if (targetList.length === 1) {
      return this.runSingle({ url: targetList[0], cookie });
    }

    let totalSaved = 0;
    let anyWaf = false;
    const results = [];

    for (const target of targetList) {
      const res = await this.runSingle({ url: target, cookie });
      results.push({ url: target, ...res });
      if (res.success) {
        totalSaved += res.count;
      }
      if (res.wafBlocked) {
        anyWaf = true;
      }
    }

    const message = `多小铺批量抓取完成！共处理 ${targetList.length} 个小铺，成功入库 ${totalSaved} 件商品。`;
    return {
      success: totalSaved > 0 || !anyWaf,
      wafBlocked: anyWaf,
      canInteractive: anyWaf,
      message,
      count: totalSaved,
      details: results
    };
  }

  /**
   * Run interactive scraping for one or multiple shops with desktop browser
   */
  async runInteractive({ url, urls } = {}) {
    const targetList = this.normalizeUrlList(urls || url || this.targetUrl);
    const browserPath = getBrowserPath();
    if (!browserPath) {
      return {
        success: false,
        message: 'No Chrome or Edge browser executable found on system.'
      };
    }

    let browser = null;
    let totalSaved = 0;
    let lastCookie = this.cookie;

    try {
      console.log(`[Interactive Scraper] Launching desktop browser: ${browserPath}`);
      browser = await puppeteer.launch({
        executablePath: browserPath,
        headless: false,
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

      for (let i = 0; i < targetList.length; i++) {
        const target = targetList[i];
        console.log(`[Interactive Scraper] [${i + 1}/${targetList.length}] Visiting: ${target}`);
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 35000 });

        // Wait for user to pass captcha if challenged
        const maxWaitMs = 60000;
        const startTime = Date.now();
        let solved = false;

        while (Date.now() - startTime < maxWaitMs) {
          const content = await page.content();
          if (!this.isWafChallenge(content)) {
            solved = true;
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
        }

        if (!solved) {
          console.warn(`[Interactive Scraper] Timeout waiting for verification on ${target}`);
          continue;
        }

        await new Promise(r => setTimeout(r, 2000));

        // Capture session cookie
        const cookies = await page.cookies();
        lastCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        if (lastCookie) {
          this.cookie = lastCookie;
        }

        const renderedHtml = await page.content();
        const shops = this.parseShops(renderedHtml, target);
        const saved = shopService.upsertBatch(shops);
        totalSaved += saved;

        logService.addLog({
          targetUrl: target,
          status: 'SUCCESS',
          itemsScraped: saved,
          message: `[${extractShopCode(target)}] 交互抓取入库 ${saved} 件商品`
        });
      }

      await browser.close();

      const message = `多小铺交互式抓取完成！共入库 ${totalSaved} 件商品，并捕获最新 Cookie 凭证。`;
      return {
        success: true,
        message,
        count: totalSaved,
        cookie: lastCookie
      };
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch {}
      }
      return {
        success: false,
        message: `Interactive scrape error: ${err.message}`,
        count: totalSaved
      };
    }
  }

  /**
   * Helper to normalize input into an array of URLs
   */
  normalizeUrlList(input) {
    if (Array.isArray(input)) {
      return input.map(s => this.formatShopUrl(s)).filter(Boolean);
    }
    if (typeof input === 'string') {
      return input
        .split(/[\n,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => this.formatShopUrl(s));
    }
    return [this.targetUrl];
  }

  formatShopUrl(str) {
    if (!str) return '';
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return str;
    }
    // If it's a code like "FT7"
    return `https://wzyp.cn/shop/${str.trim()}`;
  }

  /**
   * Seed realistic sample multi-shop data with in-stock and prices sorted
   */
  static seedSampleData() {
    const samples = [
      // FT7 小铺商品
      {
        externalId: 'wzyp_FT7_001',
        shopCode: 'FT7',
        title: 'OpenAI 5$ 开发者测试 Key (纯官方直连)',
        category: 'API额度',
        description: '官方开发者控制台导出，支持 gpt-4o-mini、tts、whisper 等基础接口快速测试。',
        price: '¥ 12.00',
        priceNum: 12.0,
        inStock: 1,
        stockText: '库存 88',
        contact: '微信: ai_service_01',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=500&auto=format&fit=crop']
      },
      {
        externalId: 'wzyp_FT7_002',
        shopCode: 'FT7',
        title: 'OpenAI 120$ 高并发企业级中转 Key',
        category: 'API额度',
        description: '国内直连极速响应，支持 gpt-4o、o1-preview 等全系大模型，每分钟万次并发。',
        price: '¥ 68.00',
        priceNum: 68.0,
        inStock: 1,
        stockText: '库存 25',
        contact: '微信: ai_service_01',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=500&auto=format&fit=crop']
      },
      {
        externalId: 'wzyp_FT7_003',
        shopCode: 'FT7',
        title: 'Claude 3.5 Sonnet 独享会员号 (含Outlook邮箱)',
        category: 'Claude专区',
        description: '原生欧美纯净IP注册，独享未激活新号，已升级至 Pro 会员，质保首登。',
        price: '¥ 145.00',
        priceNum: 145.0,
        inStock: 1,
        stockText: '库存 12',
        contact: '微信: ai_service_01',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop']
      },
      {
        externalId: 'wzyp_FT7_004',
        shopCode: 'FT7',
        title: 'ChatGPT Plus 官方代充 (正规Stripe支付/带账单)',
        category: 'ChatGPT专区',
        description: '官方合法正规卡支付，可续费，提供完整苹果/Stripe账单，支持自备号升级。',
        price: '¥ 158.00',
        priceNum: 158.0,
        inStock: 1,
        stockText: '库存 30',
        contact: '微信: ai_service_01',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7',
        images: ['https://images.unsplash.com/photo-1677442136019-21780efad99a?w=500&auto=format&fit=crop']
      },
      // 另一个小铺 (AI9) 的商品 - 有货及缺货测试
      {
        externalId: 'wzyp_AI9_001',
        shopCode: 'AI9',
        title: '海外 Apple ID 独享账号 (美区已激活)',
        category: '开发者工具',
        description: '美区 App Store 独享已激活，带密保问题与安全邮箱，可绑定免密充值卡。',
        price: '¥ 9.90',
        priceNum: 9.9,
        inStock: 1,
        stockText: '库存 150',
        contact: 'TG: @ai9_store',
        address: 'wzyp.cn/shop/AI9',
        sourceUrl: 'https://wzyp.cn/shop/AI9',
        images: ['https://images.unsplash.com/photo-1510519138197-06b8f282415a?w=500&auto=format&fit=crop']
      },
      {
        externalId: 'wzyp_AI9_002',
        shopCode: 'AI9',
        title: 'Cursor Pro AI代码编辑器月卡 (官方代升级)',
        category: '开发者工具',
        description: '支持 GPT-4o 及 Claude 3.5 Sonnet 快速补全，程序员效率神器。',
        price: '¥ 138.00',
        priceNum: 138.0,
        inStock: 1,
        stockText: '库存 18',
        contact: 'TG: @ai9_store',
        address: 'wzyp.cn/shop/AI9',
        sourceUrl: 'https://wzyp.cn/shop/AI9',
        images: ['https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=500&auto=format&fit=crop']
      },
      {
        externalId: 'wzyp_AI9_003',
        shopCode: 'AI9',
        title: '【缺货示范】ChatGPT Plus 共享车位 4人车',
        category: 'ChatGPT专区',
        description: '4人合租车位，因官方风控本周已售罄补货中。',
        price: '¥ 45.00',
        priceNum: 45.0,
        inStock: 0,
        stockText: '缺货',
        contact: 'TG: @ai9_store',
        address: 'wzyp.cn/shop/AI9',
        sourceUrl: 'https://wzyp.cn/shop/AI9',
        images: ['https://images.unsplash.com/photo-1677442136019-21780efad99a?w=500&auto=format&fit=crop']
      },
      // 第三个小铺 (VIP8) 的商品
      {
        externalId: 'wzyp_VIP8_001',
        shopCode: 'VIP8',
        title: 'GitHub Copilot 个人学生包权益资格 (一年质保)',
        category: '开发者工具',
        description: '稳定激活 VS Code / JetBrains 系列 IDE，专属导师通道验证。',
        price: '¥ 85.00',
        priceNum: 85.0,
        inStock: 1,
        stockText: '库存 40',
        contact: 'QQ: 99998888',
        address: 'wzyp.cn/shop/VIP8',
        sourceUrl: 'https://wzyp.cn/shop/VIP8',
        images: ['https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=500&auto=format&fit=crop']
      },
      {
        externalId: 'wzyp_VIP8_002',
        shopCode: 'VIP8',
        title: 'Midjourney 标准订阅会员 (月卡代充)',
        category: 'AI绘画专区',
        description: '15小时快速生成时间，无限制慢速生成，支持商用版权。',
        price: '¥ 210.00',
        priceNum: 210.0,
        inStock: 1,
        stockText: '库存 5',
        contact: 'QQ: 99998888',
        address: 'wzyp.cn/shop/VIP8',
        sourceUrl: 'https://wzyp.cn/shop/VIP8',
        images: ['https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=500&auto=format&fit=crop']
      }
    ];

    return shopService.upsertBatch(samples);
  }
}

export const scraperService = new ScraperService();
