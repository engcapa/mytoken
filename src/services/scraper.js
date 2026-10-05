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
 * Determine whether a product is in stock based on text labels
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

  // Extract explicit stock count if present, e.g. "剩余18件" or "库存 12"
  const remainingMatch = combined.match(/剩余\s*(\d+)\s*件/i);
  if (remainingMatch) {
    const count = parseInt(remainingMatch[1], 10);
    return { inStock: count > 0 ? 1 : 0, stockText: count > 0 ? `剩余${count}件` : '缺货' };
  }

  const countMatch = combined.match(/库存[:：\s]*(\d+)/i);
  if (countMatch && parseInt(countMatch[1], 10) === 0) {
    return { inStock: 0, stockText: '缺货' };
  } else if (countMatch) {
    return { inStock: 1, stockText: `库存 ${countMatch[1]}` };
  }

  if (combined.includes('库存充足')) {
    return { inStock: 1, stockText: '库存充足' };
  }
  if (combined.includes('库存少量')) {
    return { inStock: 1, stockText: '库存少量' };
  }
  if (combined.includes('库存一般')) {
    return { inStock: 1, stockText: '库存一般' };
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
    return `https://wzyp.cn/shop/${str.trim()}`;
  }

  /**
   * Seed realistic sample products based on the exact live FT7 shop screenshot
   */
  static seedSampleData() {
    const samples = [
      // ==========================================
      // FT7 小铺 - G Plus 分类真实商品 (基于截图真实数据)
      // ==========================================
      // 【有货商品 - 按价格从低到高】
      {
        externalId: 'wzyp_FT7_GP_001',
        shopCode: 'FT7',
        title: 'plus有RT有帐密 质保首登 可反代可网页',
        category: 'G Plus',
        description: '原价25元限时特惠，带RefreshToken及网页账号密码，支持反代直连或网页端直接登录。',
        price: '¥ 22.50',
        priceNum: 22.5,
        inStock: 1,
        stockText: '库存充足',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_002',
        shopCode: 'FT7',
        title: 'Plus已接马【仅反代发货Json】不能网页端',
        category: 'G Plus',
        description: '仅供反代程序配置Json使用，不支持网页端直接访问，极速自动发货。',
        price: '¥ 22.75',
        priceNum: 22.75,
        inStock: 1,
        stockText: '库存充足',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_003',
        shopCode: 'FT7',
        title: '已接马Plus不带账密【仅反代使用】401可找回有RT',
        category: 'G Plus',
        description: '带RefreshToken，若出现401认证异常可联系找回，专供API中转与反代。',
        price: '¥ 23.95',
        priceNum: 23.95,
        inStock: 1,
        stockText: '库存充足',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_004',
        shopCode: 'FT7',
        title: 'plus成品【域名邮箱】未接马 质保首登',
        category: 'G Plus',
        description: '绑定独立自定义域名邮箱，一手纯净未接码，质保首次成功登录。',
        price: '¥ 28.54',
        priceNum: 28.54,
        inStock: 1,
        stockText: '库存一般',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_005',
        shopCode: 'FT7',
        title: '未接马 Plus成品号 纯手工产出 质保首登 部分带重置',
        category: 'G Plus',
        description: '纯手工纯净环境产出，未接码成品账号，质保首登，部分批次带重置密保。',
        price: '¥ 30.02',
        priceNum: 30.02,
        inStock: 1,
        stockText: '库存少量',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_006',
        shopCode: 'FT7',
        title: 'PLUS未接马 成品号 质保首登',
        category: 'G Plus',
        description: '现成Plus成品独享号，未接码，质保首次登录。',
        price: '¥ 32.50',
        priceNum: 32.5,
        inStock: 1,
        stockText: '库存少量',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_007',
        shopCode: 'FT7',
        title: 'Plus丨已接马丨带1次重置',
        category: 'G Plus',
        description: '带一次重置密码机会，保障售后安全，已激活Plus订阅。',
        price: '¥ 36.18',
        priceNum: 36.18,
        inStock: 1,
        stockText: '剩余18件',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_008',
        shopCode: 'FT7',
        title: '【质保3h首登】plus会员iCloud或者域名邮箱新开的各种渠道',
        category: 'G Plus',
        description: '新开iCloud/优质域名邮箱渠道，3小时首登无忧售后保障。',
        price: '¥ 36.30',
        priceNum: 36.3,
        inStock: 1,
        stockText: '剩余3件',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_009',
        shopCode: 'FT7',
        title: 'Plus丨已接马丨带2-3次重置',
        category: 'G Plus',
        description: '高权重账号，带2到3次重置密保卡，长期使用更稳定。',
        price: '¥ 41.80',
        priceNum: 41.8,
        inStock: 1,
        stockText: '库存充足',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_010',
        shopCode: 'FT7',
        title: 'Plus成品号 未接马 质保首登 (高级独享)',
        category: 'G Plus',
        description: '独享高级成品号，未接马，质保首次登录。',
        price: '¥ 47.13',
        priceNum: 47.13,
        inStock: 1,
        stockText: '库存少量',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_011',
        shopCode: 'FT7',
        title: 'iCloud邮箱|PLUS成品号已刷满额度+1张重置卡|还剩4天',
        category: 'G Plus',
        description: 'iCloud原生邮箱，已刷满使用额度，附带1张重置卡，剩余订阅有效期4天。',
        price: '¥ 60.74',
        priceNum: 60.74,
        inStock: 1,
        stockText: '剩余1件',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_012',
        shopCode: 'FT7',
        title: '【稳】10月4号产PLUS独享|实卡最稳|已稳定25天',
        category: 'G Plus',
        description: '真实海外实体信用卡支付订阅，已平稳运行25天未翻车，极其抗封。',
        price: '¥ 71.90',
        priceNum: 71.9,
        inStock: 1,
        stockText: '库存一般',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_013',
        shopCode: 'FT7',
        title: '域名邮箱PLUS成品号已刷|已活4天',
        category: 'G Plus',
        description: '域名邮箱注册，已安全度过前4天风控期。',
        price: '¥ 76.76',
        priceNum: 76.76,
        inStock: 1,
        stockText: '剩余2件',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_014',
        shopCode: 'FT7',
        title: '【官方充值】Codex AI Plus 全自动24小时自动充值CDK',
        category: 'G Plus',
        description: '全自动24小时卡密自动充值兑换，官方正规渠道。',
        price: '¥ 127.00',
        priceNum: 127.0,
        inStock: 1,
        stockText: '库存充足',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_015',
        shopCode: 'FT7',
        title: '【官方充值】非区G plus cdk24小时自动充值',
        category: 'G Plus',
        description: '非区专用官方直充兑换卡密，即买即充，无延迟。',
        price: '¥ 132.00',
        priceNum: 132.0,
        inStock: 1,
        stockText: '库存充足',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },

      // 【截图中展示的部分缺货商品 - 供缺货过滤对比测试】
      {
        externalId: 'wzyp_FT7_GP_016_oos',
        shopCode: 'FT7',
        title: '【无质保】G plus U端 未接马',
        category: 'G Plus',
        description: '低价走量款，无质保首登，当前批次已售罄。',
        price: '¥ 11.39',
        priceNum: 11.39,
        inStock: 0,
        stockText: '缺货',
        contact: 'TG: https://t.me/ft7tz',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_017_oos',
        shopCode: 'FT7',
        title: '新日期Plus成品 质保首登 momo渠道',
        category: 'G Plus',
        description: '本周momo渠道热销已抢空。',
        price: '¥ 14.00',
        priceNum: 14.0,
        inStock: 0,
        stockText: '缺货',
        contact: 'TG: https://t.me/ft7tz',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GP_018_oos',
        shopCode: 'FT7',
        title: 'G Plus月卡 稳如老狗 放心购买 已接马',
        category: 'G Plus',
        description: '原价30元特价22元，目前缺货等待补卡中。',
        price: '¥ 22.00',
        priceNum: 22.0,
        inStock: 0,
        stockText: '缺货',
        contact: 'TG: https://t.me/ft7tz',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },

      // ==========================================
      // FT7 小铺 - 其他分类商品 (对应截图顶部Tabs)
      // ==========================================
      // Claude | g.rok (共24种商品中的代表性在售商品)
      {
        externalId: 'wzyp_FT7_CL_001',
        shopCode: 'FT7',
        title: 'G.rok 2 早期测试资格账号 (含X Premium权限)',
        category: 'Claude | g.rok',
        description: '附带X平台会员权限，畅享Grok 2生图及深度对话能力。',
        price: '¥ 45.00',
        priceNum: 45.0,
        inStock: 1,
        stockText: '库存 16',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_CL_002',
        shopCode: 'FT7',
        title: 'Claude 3.5 Sonnet Pro 官方月度订阅独享号',
        category: 'Claude | g.rok',
        description: '欧美原生IP开通Pro计划，无合租风险，质保首登。',
        price: '¥ 145.00',
        priceNum: 145.0,
        inStock: 1,
        stockText: '库存 8',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },

      // 谷歌 | Gemini (共23种商品)
      {
        externalId: 'wzyp_FT7_GM_001',
        shopCode: 'FT7',
        title: 'Google One 2TB + Gemini Advanced 体验号 (1个月)',
        category: '谷歌 | Gemini',
        description: '官方2TB云存储空间，解锁Gemini 1.5 Pro百万上下文特权。',
        price: '¥ 18.50',
        priceNum: 18.5,
        inStock: 1,
        stockText: '库存 35',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_GM_002',
        shopCode: 'FT7',
        title: 'Gemini Advanced 独享学生认证号 (1年期资格)',
        category: '谷歌 | Gemini',
        description: '长期稳定通道，附赠教育权益和高额云盘容量。',
        price: '¥ 78.00',
        priceNum: 78.0,
        inStock: 1,
        stockText: '库存 10',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },

      // Codex 接码 (共21种商品)
      {
        externalId: 'wzyp_FT7_CX_001',
        shopCode: 'FT7',
        title: 'OpenAI 注册接码专用卡密 (一次性API验证码)',
        category: 'Codex 接码',
        description: '支持注册全新ChatGPT账号，高到达率，超时自动返还。',
        price: '¥ 3.50',
        priceNum: 3.5,
        inStock: 1,
        stockText: '库存 200',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },
      {
        externalId: 'wzyp_FT7_CX_002',
        shopCode: 'FT7',
        title: '英国物理实体手机卡代接码 (一次验证有效)',
        category: 'Codex 接码',
        description: '英国原生实体卡，非虚拟号段，专解高风控业务绑定。',
        price: '¥ 15.00',
        priceNum: 15.0,
        inStock: 1,
        stockText: '库存 45',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      },

      // G K12 Team (共16种商品)
      {
        externalId: 'wzyp_FT7_TM_001',
        shopCode: 'FT7',
        title: 'ChatGPT Team 团队工作区车位 (月付合租)',
        category: 'G K12 Team',
        description: '无限GPT-4o对话次数，独立对话隔离保护，企业级通道。',
        price: '¥ 48.00',
        priceNum: 48.0,
        inStock: 1,
        stockText: '剩余6件',
        contact: 'TG: https://t.me/ft7tz | QQ: 1091631176',
        address: 'wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/shop/FT7'
      }
    ];

    return shopService.upsertBatch(samples);
  }
}

export const scraperService = new ScraperService();
