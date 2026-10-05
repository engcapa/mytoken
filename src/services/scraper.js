import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import config from '../config/index.js';
import { shopService, logService } from './db.js';
import { jevService, parseProxy } from './jev.js';

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
 * Strip HTML tags and normalize whitespace
 */
export function stripHtml(html = '') {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*[\/]?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract numeric price for accurate sorting (e.g. "¥ 145.00 起" -> 145)
 */
export function parseNumericPrice(priceStr = '') {
  if (typeof priceStr === 'number') return priceStr;
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

const MODERN_FINGERPRINTS = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    platform: '"Windows"'
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    secChUa: '"Microsoft Edge";v="129", "Chromium";v="129", "Not=A?Brand";v="24"',
    platform: '"Windows"'
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    platform: '"macOS"'
  }
];

export function getRandomFingerprint() {
  return MODERN_FINGERPRINTS[Math.floor(Math.random() * MODERN_FINGERPRINTS.length)];
}

export function humanDelay(minMs = 1200, maxMs = 2800, action = '') {
  if (!config.antiBan.enabled) return Promise.resolve();
  const duration = Math.floor(minMs + Math.random() * (maxMs - minMs));
  if (action) {
    console.log(`[拟人化防封] ${action}，模拟人类阅读与操作停顿 ${(duration / 1000).toFixed(2)} 秒...`);
  }
  return new Promise(r => setTimeout(r, duration));
}

export function buildBrowserHeaders(shopCode = '', customCookie = '', isHtml = false) {
  const fp = getRandomFingerprint();
  const headers = {
    'User-Agent': fp.userAgent,
    'Accept': isHtml
      ? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      : 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'sec-ch-ua': fp.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': fp.platform,
    'sec-fetch-dest': isHtml ? 'document' : 'empty',
    'sec-fetch-mode': isHtml ? 'navigate' : 'cors',
    'sec-fetch-site': 'same-origin'
  };

  if (isHtml) {
    headers['Upgrade-Insecure-Requests'] = '1';
  } else {
    headers['Origin'] = 'https://wzyp.cn';
    headers['Content-Type'] = 'application/json';
  }

  if (shopCode) {
    headers['Referer'] = `https://wzyp.cn/shop/${shopCode}`;
  }
  if (customCookie) {
    headers['Cookie'] = customCookie;
  }
  return headers;
}

/**
 * Robust HTTP request executor with automatic proxy fallback & backoff retries
 */
export async function executeWithAntiBan(requestFn, { shopCode = '', label = '' } = {}) {
  let attempt = 0;
  const maxAttempts = 3;
  let useProxy = config.proxy.enabled;

  while (attempt < maxAttempts) {
    attempt++;
    const proxyUrl = config.proxy.httpsProxy || config.proxy.httpProxy || config.proxy.allProxy;
    const activeProxy = (useProxy && proxyUrl) ? parseProxy(proxyUrl) : false;

    try {
      const res = await requestFn(activeProxy);
      const isBlocked = res?.status === 520 || res?.status === 502 || res?.status === 429;
      if (isBlocked) {
        console.warn(`[拟人化防封] 收到阻断响应 HTTP ${res.status} (${label})。`);
        if (!useProxy && proxyUrl && config.antiBan.autoProxyFallback) {
          console.log(`[拟人化防封] 自动开启代理通道 (${proxyUrl}) 并重试...`);
          useProxy = true;
          await humanDelay(1500, 3000, '切换代理通道');
          continue;
        }
        if (attempt < maxAttempts) {
          await humanDelay(2000 * attempt, 3500 * attempt, '风控冷却退避');
          continue;
        }
      }
      return res;
    } catch (err) {
      console.warn(`[拟人化防封] 请求网络异常 (${label}): ${err.message}`);
      const proxyUrl = config.proxy.httpsProxy || config.proxy.httpProxy || config.proxy.allProxy;
      if (!useProxy && proxyUrl && config.antiBan.autoProxyFallback) {
        console.log(`[拟人化防封] 遇到网络异常，自动启用代理通道 (${proxyUrl}) 重试...`);
        useProxy = true;
        await humanDelay(1500, 2500, '切换代理通道');
        continue;
      }
      if (attempt < maxAttempts) {
        await humanDelay(2000, 3500, '重试前等待');
      } else {
        throw err;
      }
    }
  }
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
   * Directly fetch shop data from wzyp.cn internal JSON APIs
   * Emulates realistic human browsing pauses and sequential category traversal
   */
  async fetchShopViaApi(shopCode, customCookie = '') {
    if (!shopCode) return { success: false, items: [], message: 'No shop code' };

    const cookie = customCookie || this.cookie;

    // 1. Fetch category list with anti-ban wrapper
    let catData;
    try {
      const catRes = await executeWithAntiBan(
        (proxyConfig) => axios.post(
          'https://wzyp.cn/shopApi/Shop/categoryList',
          { token: shopCode, goods_type: 'card', category_key: '' },
          {
            headers: buildBrowserHeaders(shopCode, cookie),
            proxy: proxyConfig,
            timeout: 15000,
            validateStatus: () => true
          }
        ),
        { shopCode, label: `小铺 [${shopCode}] 分类列表` }
      );

      if (!catRes || catRes.status >= 400 || !catRes.data || catRes.data.code !== 1) {
        return {
          success: false,
          wafBlocked: catRes?.status === 403 || this.isWafChallenge(typeof catRes?.data === 'string' ? catRes.data : ''),
          items: [],
          message: `Category API response failed with code: ${catRes?.data?.code || catRes?.status}`
        };
      }
      catData = catRes.data.data || [];
    } catch (err) {
      return { success: false, items: [], message: `Category API request error: ${err.message}` };
    }

    if (!Array.isArray(catData) || catData.length === 0) {
      return { success: false, items: [], message: 'No categories returned by shopApi' };
    }

    // 2. Fetch products for each category SEQUENTIALLY to emulate human browsing
    const allItems = [];
    console.log(`[拟人化防封] 小铺 [${shopCode}] 共有 ${catData.length} 个分类，按人类阅读节奏逐个采集...`);

    for (let cIdx = 0; cIdx < catData.length; cIdx++) {
      const cat = catData[cIdx];
      console.log(`[小铺 ${shopCode}] [${cIdx + 1}/${catData.length}] 正在采集分类: 【${cat.name}】...`);

      try {
        let currentPage = 1;
        let hasMore = true;

        while (hasMore) {
          const goodsRes = await executeWithAntiBan(
            (proxyConfig) => axios.post(
              'https://wzyp.cn/shopApi/Shop/goodsList',
              {
                token: shopCode,
                keywords: '',
                category_id: cat.id,
                goods_type: 'card',
                current: currentPage,
                pageSize: 100
              },
              {
                headers: buildBrowserHeaders(shopCode, cookie),
                proxy: proxyConfig,
                timeout: 15000,
                validateStatus: () => true
              }
            ),
            { shopCode, label: `分类【${cat.name}】第 ${currentPage} 页` }
          );

          if (!goodsRes || goodsRes.status !== 200 || !goodsRes.data?.data?.list) {
            break;
          }

          const list = goodsRes.data.data.list || [];
          const total = goodsRes.data.data.total || list.length;

          for (const g of list) {
            const goodsKey = g.goods_key || '';
            const directLink = g.link || (goodsKey ? `https://wzyp.cn/item/${goodsKey}` : `https://wzyp.cn/shop/${shopCode}`);
            const stockCount = g.extend?.stock_count;
            const inStock = stockCount !== undefined ? (stockCount > 0 ? 1 : 0) : 1;
            const stockText = stockCount !== undefined ? (stockCount > 0 ? `剩余${stockCount}件` : '缺货') : '有货';
            const priceNum = typeof g.price === 'number' ? g.price : parseNumericPrice(g.price);
            const cleanDesc = stripHtml(g.description || '');

            allItems.push({
              externalId: goodsKey ? `wzyp_${goodsKey}` : `wzyp_${shopCode}_${cat.id}_${encodeURIComponent(g.name || '')}`,
              title: g.name || '未命名商品',
              category: cat.name || g.category?.name || '综合专区',
              description: cleanDesc,
              price: g.price !== undefined ? `¥ ${g.price}` : '',
              priceNum,
              inStock,
              stockText,
              shopCode,
              contact: g.user?.nickname || `小铺 ${shopCode}`,
              address: `https://wzyp.cn/shop/${shopCode}`,
              sourceUrl: directLink,
              images: g.image ? [g.image] : [],
              rawData: {
                goods_key: goodsKey,
                market_price: g.market_price,
                stock_count: stockCount,
                category_id: cat.id,
                extractedAt: new Date().toISOString()
              }
            });
          }

          if (currentPage * 100 >= total || list.length === 0) {
            hasMore = false;
          } else {
            currentPage++;
            // Human reading pause between pages
            await humanDelay(800, 1600, `分类【${cat.name}】翻页`);
          }
        }
      } catch (catErr) {
        console.warn(`[Scraper] Failed to fetch goods for category [${cat.name}] in shop [${shopCode}]:`, catErr.message);
      }

      // Human browsing delay between categories
      if (cIdx < catData.length - 1) {
        await humanDelay(
          config.antiBan.minDelayMs,
          config.antiBan.maxDelayMs,
          `小铺 [${shopCode}] 切换至下一分类`
        );
      }
    }

    return {
      success: allItems.length > 0,
      items: allItems,
      categoriesCount: catData.length
    };
  }

  /**
   * Perform HTTP fetch with browser-like headers and anti-ban retry
   */
  async fetchHtml(url, customCookie = '') {
    const cookie = customCookie || this.cookie;
    const shopCode = extractShopCode(url);

    const response = await executeWithAntiBan(
      (proxyConfig) => axios.get(url, {
        headers: buildBrowserHeaders(shopCode, cookie, true),
        proxy: proxyConfig,
        timeout: 15000,
        validateStatus: () => true
      }),
      { shopCode, label: `HTML页面 [${url}]` }
    );

    return {
      status: response?.status || 0,
      headers: response?.headers || {},
      data: response?.data || ''
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
      html.includes('aliyunCaptcha') ||
      html.includes('Denied by http_bot_simple')
    );
  }

  /**
   * Resilient DOM Parser supporting multiple shop themes and layouts
   * Integrates TypeSafe Jev System One model to intelligently identify the genuine products container
   */
  async parseShops(html, baseUrl) {
    const $ = cheerio.load(html);
    const shops = [];
    const shopCode = extractShopCode(baseUrl);

    // Extract shop-level info
    const shopHeaderTitle = $('.shop-name, .shop-title, h1, .header-title, .navbar-brand, .user_name').first().text().trim() ||
                            (shopCode ? `小铺 ${shopCode}` : 'wzyp小铺');
    const shopNotice = $('.notice, .announcement, .bulletin, .alert, .shop-desc').first().text().trim();
    const shopContact = $('.contact, .qq, .wechat, .phone, .service-contact').first().text().trim();

    // Check across diverse shop themes for goods containers
    const selectors = [
      '.goods_item',
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
      '.arco-card',
      '.arco-list-item',
      '[class*="goods_item"]',
      '[class*="goods-item"]',
      'table tbody tr'
    ];

    const candidates = [];
    for (const sel of selectors) {
      const elements = $(sel);
      if (elements.length > 0) {
        candidates.push({
          selector: sel,
          elements,
          count: elements.length,
          sampleText: elements.first().text().replace(/\s+/g, ' ').trim().slice(0, 100)
        });
      }
    }

    let chosenCandidate = candidates[0] || null;

    // TypeSafe Jev System One Assistance
    if (candidates.length > 1 && jevService.enabled && jevService.apiKey) {
      try {
        console.log(`[Jev Assistant] Evaluating ${candidates.length} candidate container structures with TypeSafe Jev...`);
        const jevJudgement = await jevService.judgeProductContainers(candidates);
        if (jevJudgement?.chosenCandidate) {
          chosenCandidate = jevJudgement.chosenCandidate;
          console.log(`[Jev Assistant] Decision: Selected "${chosenCandidate.selector}" with confidence ${(jevJudgement.confidence * 100).toFixed(1)}%`);
        }
      } catch (jevErr) {
        console.warn('[Jev Assistant] Evaluation bypassed due to error:', jevErr.message);
      }
    }

    if (chosenCandidate && chosenCandidate.elements.length > 0) {
      chosenCandidate.elements.each((index, el) => {
        const item = $(el);
        const title = item.find('h1, h2, h3, h4, .title, .name, .goods-name, .goods-title, .goods_name, td.name, td.title').first().text().trim() ||
                      item.find('a').first().text().trim();
        if (!title || title.length < 2) return;

        // Resolve direct product item link: prioritize /item/{goods_key}
        let directItemUrl = '';
        const itemKey = item.attr('data-goods-key') || item.attr('data-key') || item.attr('data-id');
        if (itemKey && /^[a-zA-Z0-9_-]{4,20}$/.test(itemKey)) {
          directItemUrl = `https://wzyp.cn/item/${itemKey}`;
        }

        if (!directItemUrl) {
          const itemHref = item.find('a[href*="/item/"]').first().attr('href') ||
                           item.find('a').first().attr('href') || '';
          if (itemHref) {
            try {
              directItemUrl = new URL(itemHref, baseUrl).href;
            } catch {}
          }
        }

        const fullUrl = directItemUrl || baseUrl;
        const img = item.find('img').first().attr('src') || '';
        const fullImg = img ? (img.startsWith('http') ? img : new URL(img, baseUrl).href) : '';

        const desc = stripHtml(item.find('.desc, .description, .intro, .detail, p, td.desc').first().text().trim() || shopNotice);
        const price = item.find('.nowPrice, .price, .cost, .tag-price, .goods-price, td.price').first().text().trim();
        const priceNum = parseNumericPrice(price);

        const category = item.find('.category, .tag, .badge, .van-tag, td.category').first().text().trim() ||
                         (shopHeaderTitle || '综合专区');
        const contact = item.find('.contact, .phone, .wechat, .author').first().text().trim() || shopContact;
        const address = item.find('.address, .location').first().text().trim() || baseUrl;

        // Stock status
        const rawStockText = item.find('.stock, .inventory, .badge-stock, td.stock').first().text().trim();
        const { inStock, stockText } = parseStockStatus(rawStockText, item.text());

        // Construct stable externalId
        const matchKey = fullUrl.match(/\/item\/([a-zA-Z0-9_-]+)/i);
        const externalId = matchKey ? `wzyp_${matchKey[1]}` :
                           (fullUrl !== baseUrl ? `${fullUrl}_${index}` : `item_${shopCode}_${index}_${encodeURIComponent(title.substring(0, 30))}`);

        shops.push({
          externalId,
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
          sourceUrl: fullUrl, // Direct product link!
          images: fullImg ? [fullImg] : [],
          rawData: {
            selectorUsed: chosenCandidate.selector,
            shopTitle: shopHeaderTitle,
            extractedAt: new Date().toISOString()
          }
        });
      });
    }

    return shops;
  }

  /**
   * Run browser-based extraction (headless or interactive)
   * Automatically executes API evaluation within the authenticated page session
   */
  async scrapeShopViaBrowser(targetUrl, { interactive = false } = {}) {
    const browserPath = getBrowserPath();
    if (!browserPath) {
      return { success: false, message: 'Chrome or Edge browser executable not found.' };
    }

    const shopCode = extractShopCode(targetUrl);
    let browser = null;

    try {
      console.log(`[Browser Scraper] Launching ${interactive ? 'interactive' : 'headless'} browser for: ${targetUrl}`);
      const fp = getRandomFingerprint();
      const browserArgs = [
        '--window-size=1280,850',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ];
      const proxyUrl = config.proxy.httpsProxy || config.proxy.httpProxy || config.proxy.allProxy;
      if (config.proxy.enabled && proxyUrl) {
        browserArgs.push(`--proxy-server=${proxyUrl}`);
      }

      browser = await puppeteer.launch({
        executablePath: browserPath,
        headless: !interactive,
        defaultViewport: null,
        args: browserArgs
      });

      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      await page.setUserAgent(fp.userAgent);

      // Stealth evasion to bypass bot detection
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' }
          ]
        });
      });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Simulate human-like mouse movement and gentle scrolling
      if (config.antiBan.simulateHumanBehavior) {
        try {
          console.log(`[拟人化防封] 浏览器模拟人类轻微视口滚动与鼠标轨迹...`);
          await page.mouse.move(150 + Math.random() * 200, 150 + Math.random() * 100);
          await page.mouse.move(450 + Math.random() * 200, 320 + Math.random() * 150, { steps: 20 });
          await page.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' }));
          await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
          await page.evaluate(() => window.scrollBy({ top: -80, behavior: 'smooth' }));
        } catch {
          // Non-critical
        }
      }

      // Handle WAF challenge
      const maxWaitMs = interactive ? 60000 : 5000;
      const startTime = Date.now();
      let hasChallenge = false;

      while (Date.now() - startTime < maxWaitMs) {
        const content = await page.content();
        if (this.isWafChallenge(content)) {
          hasChallenge = true;
          await new Promise(r => setTimeout(r, 1000));
        } else {
          hasChallenge = false;
          break;
        }
      }

      if (hasChallenge && !interactive) {
        await browser.close();
        return {
          success: false,
          wafBlocked: true,
          message: `[${shopCode}] 触发了滑动验证，请使用“交互验证抓取”以手动完成滑块验证。`
        };
      }

      // Capture active cookies
      const cookies = await page.cookies();
      const sessionCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      if (sessionCookie) {
        this.cookie = sessionCookie;
      }

      // Execute internal API evaluation inside the authenticated browser context
      const apiResult = await page.evaluate(async (token) => {
        try {
          const catRes = await fetch('/shopApi/Shop/categoryList', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, goods_type: 'card', category_key: '' })
          }).then(r => r.json());

          if (!catRes || catRes.code !== 1 || !Array.isArray(catRes.data) || catRes.data.length === 0) {
            return { success: false, items: [] };
          }

          const items = [];
          for (const cat of catRes.data) {
            let pageNum = 1;
            let more = true;
            while (more) {
              try {
                const gRes = await fetch('/shopApi/Shop/goodsList', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token, keywords: '', category_id: cat.id, goods_type: 'card', current: pageNum, pageSize: 100 })
                }).then(r => r.json());

                const list = gRes.data?.list || [];
                const total = gRes.data?.total || list.length;

                for (const g of list) {
                  items.push({
                    goods_key: g.goods_key,
                    name: g.name,
                    category_name: cat.name || g.category?.name,
                    description: g.description,
                    price: g.price,
                    link: g.link,
                    image: g.image,
                    stock_count: g.extend?.stock_count,
                    shop_nickname: g.user?.nickname
                  });
                }

                if (pageNum * 100 >= total || list.length === 0) {
                  more = false;
                } else {
                  pageNum++;
                }
              } catch (gErr) {
                more = false;
              }
            }
            await new Promise(r => setTimeout(r, 60));
          }
          return { success: items.length > 0, items };
        } catch (e) {
          return { success: false, error: e.message, items: [] };
        }
      }, shopCode);

      let goods = [];
      if (apiResult.success && apiResult.items.length > 0) {
        goods = apiResult.items.map(g => {
          const directLink = g.link || (g.goods_key ? `https://wzyp.cn/item/${g.goods_key}` : `https://wzyp.cn/shop/${shopCode}`);
          const stockCount = g.stock_count;
          const inStock = stockCount !== undefined ? (stockCount > 0 ? 1 : 0) : 1;
          const stockText = stockCount !== undefined ? (stockCount > 0 ? `剩余${stockCount}件` : '缺货') : '有货';
          const priceNum = typeof g.price === 'number' ? g.price : parseNumericPrice(g.price);

          return {
            externalId: g.goods_key ? `wzyp_${g.goods_key}` : `wzyp_${shopCode}_${encodeURIComponent(g.name || '')}`,
            title: g.name || '未命名商品',
            category: g.category_name || '综合专区',
            description: stripHtml(g.description || ''),
            price: g.price !== undefined ? `¥ ${g.price}` : '',
            priceNum,
            inStock,
            stockText,
            shopCode,
            contact: g.shop_nickname || `小铺 ${shopCode}`,
            address: `https://wzyp.cn/shop/${shopCode}`,
            sourceUrl: directLink, // Specific product detail link!
            images: g.image ? [g.image] : [],
            rawData: {
              goods_key: g.goods_key,
              stock_count: stockCount,
              extractedVia: 'browser_evaluate',
              extractedAt: new Date().toISOString()
            }
          };
        });
      } else {
        // Fallback: parse rendered DOM across varying themes
        const renderedHtml = await page.content();
        goods = await this.parseShops(renderedHtml, targetUrl);
      }

      await browser.close();

      return {
        success: goods.length > 0,
        items: goods,
        cookie: sessionCookie
      };
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch {}
      }
      return { success: false, message: err.message, items: [] };
    }
  }

  /**
   * Run standard scraping for a single shop URL
   * Strategy: Fast JSON API -> Fallback to Headless Browser -> Fallback to HTML DOM parser
   */
  async runSingle({ url = this.targetUrl, cookie = this.cookie } = {}) {
    const target = url || this.targetUrl;
    const shopCode = extractShopCode(target);

    try {
      // 1. First attempt: Direct High-Fidelity API extraction
      const apiResult = await this.fetchShopViaApi(shopCode, cookie);
      if (apiResult.success && apiResult.items.length > 0) {
        const savedCount = shopService.upsertBatch(apiResult.items);
        const message = `[${shopCode}] 采集成功！共提取 ${apiResult.items.length} 件商品（覆盖 ${apiResult.categoriesCount || 1} 个分类），成功入库 ${savedCount} 条。`;

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
          items: apiResult.items
        };
      }

      // If blocked by WAF, try browser mode
      if (apiResult.wafBlocked) {
        console.log(`[Scraper] API blocked by WAF for ${shopCode}, attempting browser fallback...`);
        const browserRes = await this.scrapeShopViaBrowser(target, { interactive: false });
        if (browserRes.success && browserRes.items.length > 0) {
          const savedCount = shopService.upsertBatch(browserRes.items);
          const message = `[${shopCode}] 浏览器静默采集成功！提取 ${browserRes.items.length} 件商品，入库 ${savedCount} 条。`;
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
            cookie: browserRes.cookie
          };
        }

        if (browserRes.wafBlocked) {
          const errorMsg = `[${shopCode}] 触发了阿里云ESA滑动验证保护。请点击“交互验证抓取”以手动完成滑块。`;
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
      }

      // 2. Fallback: Standard HTML fetch & multi-theme DOM parser
      const response = await this.fetchHtml(target, cookie);
      if (this.isWafChallenge(response.data)) {
        const errorMsg = `[${shopCode}] 触发了滑动验证页面。请使用“交互验证抓取”。`;
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

      const shops = await this.parseShops(response.data, target);
      if (shops.length > 0) {
        const savedCount = shopService.upsertBatch(shops);
        const message = `[${shopCode}] DOM解析成功！解析到 ${shops.length} 条商品，保存 ${savedCount} 条。`;
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
      }

      // If still 0 items, run browser once as final fallback
      const finalBrowserRes = await this.scrapeShopViaBrowser(target, { interactive: false });
      if (finalBrowserRes.success && finalBrowserRes.items.length > 0) {
        const savedCount = shopService.upsertBatch(finalBrowserRes.items);
        const message = `[${shopCode}] 抓取成功！解析到 ${finalBrowserRes.items.length} 件商品，入库 ${savedCount} 条。`;
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
          cookie: finalBrowserRes.cookie
        };
      }

      const emptyMsg = `[${shopCode}] 未在小铺页面中解析到在售商品，可能需要验证或页面格式特殊。`;
      logService.addLog({
        targetUrl: target,
        status: 'FAILED',
        itemsScraped: 0,
        message: emptyMsg
      });

      return {
        success: false,
        wafBlocked: false,
        message: emptyMsg,
        count: 0
      };
    } catch (err) {
      const message = `[${shopCode}] 抓取异常: ${err.message}`;
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

    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i];
      const res = await this.runSingle({ url: target, cookie });
      results.push({ url: target, ...res });
      if (res.success) {
        totalSaved += res.count;
      }
      if (res.wafBlocked) {
        anyWaf = true;
      }

      // Human-like pause between multiple shops
      if (i < targetList.length - 1) {
        await humanDelay(
          config.antiBan.shopDelayMs,
          config.antiBan.shopDelayMs + 2000,
          `小铺 [${extractShopCode(target)}] 采集完成，准备进入下一小铺`
        );
      }
    }

    if (totalSaved > 0) {
      try {
        await jevService.harmonizeAllCategories(shopService);
      } catch (err) {
        console.warn('[Scraper] Auto harmonization warning:', err.message);
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
    let totalSaved = 0;
    let lastCookie = this.cookie;

    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i];
      const shopCode = extractShopCode(target);
      console.log(`[Interactive Scraper] [${i + 1}/${targetList.length}] Processing shop: ${target}`);

      const browserRes = await this.scrapeShopViaBrowser(target, { interactive: true });
      if (browserRes.success && browserRes.items.length > 0) {
        const saved = shopService.upsertBatch(browserRes.items);
        totalSaved += saved;
        if (browserRes.cookie) {
          lastCookie = browserRes.cookie;
          this.cookie = lastCookie;
        }

        logService.addLog({
          targetUrl: target,
          status: 'SUCCESS',
          itemsScraped: saved,
          message: `[${shopCode}] 交互式抓取成功！共提取 ${browserRes.items.length} 件商品，入库 ${saved} 条。`
        });
      } else {
        logService.addLog({
          targetUrl: target,
          status: 'FAILED',
          itemsScraped: 0,
          message: `[${shopCode}] 交互抓取未能提取到商品: ${browserRes.message || '未知原因'}`
        });
      }

      // Human-like pause between multiple shops
      if (i < targetList.length - 1) {
        await humanDelay(
          config.antiBan.shopDelayMs,
          config.antiBan.shopDelayMs + 2000,
          `小铺 [${shopCode}] 交互抓取完成，准备切换至下一小铺`
        );
      }
    }

    if (totalSaved > 0) {
      try {
        await jevService.harmonizeAllCategories(shopService);
      } catch (err) {
        console.warn('[Scraper] Auto harmonization warning:', err.message);
      }
    }

    const message = `多小铺交互抓取完成！共处理 ${targetList.length} 个小铺，入库 ${totalSaved} 件商品。`;
    return {
      success: totalSaved > 0,
      message,
      count: totalSaved,
      cookie: lastCookie
    };
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
   * Seed realistic sample products based on actual FT7 and G062JE24 shop items
   * All items link to their specific product detail page (/item/{goods_key})
   */
  static seedSampleData() {
    const samples = [
      // ==========================================
      // FT7 小铺 - G Plus 分类真实商品
      // ==========================================
      {
        externalId: 'wzyp_rmvq91',
        shopCode: 'FT7',
        title: '【官方充值】Codex AI Plus [菲区] CDK 质保订阅30天',
        category: 'G Plus',
        description: '官方正规充值CDK卡密，支持24小时全自动提卡兑换，质保30天完整订阅周期。',
        price: '¥ 127.00',
        priceNum: 127.0,
        inStock: 1,
        stockText: '剩余100件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/rmvq91'
      },
      {
        externalId: 'wzyp_4bahii',
        shopCode: 'FT7',
        title: '【官方充值】菲区G plus cdk24小时（质保30天）正规充值',
        category: 'G Plus',
        description: '菲区专用官方直充兑换卡密，即买即充，无延迟，质保30天。',
        price: '¥ 132.00',
        priceNum: 132.0,
        inStock: 1,
        stockText: '剩余519件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/4bahii'
      },
      {
        externalId: 'wzyp_bojjp1',
        shopCode: 'FT7',
        title: 'Plus已接马【仅反代发货Json】不能网页端',
        category: 'G Plus',
        description: '仅供反代程序配置Json使用，不支持网页端直接访问，极速自动发货。',
        price: '¥ 22.75',
        priceNum: 22.75,
        inStock: 1,
        stockText: '剩余25件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/bojjp1'
      },
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
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_GP_001'
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
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_GP_007'
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
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_GP_012'
      },

      // ==========================================
      // FT7 小铺 - 其他分类商品
      // ==========================================
      {
        externalId: 'wzyp_FT7_CL_001',
        shopCode: 'FT7',
        title: 'G.rok 2 早期测试资格账号 (含X Premium权限)',
        category: 'Claude | g.rok',
        description: '附带X平台会员权限，畅享Grok 2生图及深度对话能力。',
        price: '¥ 45.00',
        priceNum: 45.0,
        inStock: 1,
        stockText: '剩余16件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_CL_001'
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
        stockText: '剩余8件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_CL_002'
      },
      {
        externalId: 'wzyp_FT7_GM_001',
        shopCode: 'FT7',
        title: 'Google One 2TB + Gemini Advanced 体验号 (1个月)',
        category: '谷歌 | Gemini',
        description: '官方2TB云存储空间，解锁Gemini 1.5 Pro百万上下文特权。',
        price: '¥ 18.50',
        priceNum: 18.5,
        inStock: 1,
        stockText: '剩余35件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_GM_001'
      },
      {
        externalId: 'wzyp_FT7_CX_001',
        shopCode: 'FT7',
        title: 'OpenAI 注册接码专用卡密 (一次性API验证码)',
        category: 'Codex 接马',
        description: '支持注册全新ChatGPT账号，高到达率，超时自动返还。',
        price: '¥ 3.50',
        priceNum: 3.5,
        inStock: 1,
        stockText: '剩余200件',
        contact: 'FT7的小店',
        address: 'https://wzyp.cn/shop/FT7',
        sourceUrl: 'https://wzyp.cn/item/FT7_CX_001'
      },

      // ==========================================
      // G062JE24 小铺 - 中转站 & 模型服务分类商品
      // ==========================================
      {
        externalId: 'wzyp_mf3onp',
        shopCode: 'G062JE24',
        title: 'OpenAI与Claude中转1刀',
        category: '中转站',
        description: '1:1 额度卡，购买后前往自助兑换，额度将自动充入账户。',
        price: '¥ 1.00',
        priceNum: 1.0,
        inStock: 1,
        stockText: '剩余20件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/mf3onp'
      },
      {
        externalId: 'wzyp_17bfg2',
        shopCode: 'G062JE24',
        title: '智谱5.3最新的日卡服务',
        category: '中转站',
        description: '智谱GLM-5.3日卡，24h有效，500次大模型请求，支持编程套餐服务。',
        price: '¥ 4.20',
        priceNum: 4.2,
        inStock: 1,
        stockText: '剩余168件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/17bfg2'
      },
      {
        externalId: 'wzyp_2ghl57',
        shopCode: 'G062JE24',
        title: 'OpenAI与Claude中转10刀',
        category: '中转站',
        description: '1:1 额度卡，购买后自助兑换，额度自动充入账户，体验满意再下单。',
        price: '¥ 10.00',
        priceNum: 10.0,
        inStock: 1,
        stockText: '剩余14件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/2ghl57'
      },
      {
        externalId: 'wzyp_tbk6gz',
        shopCode: 'G062JE24',
        title: '智铺周卡服务',
        category: '中转站',
        description: '智谱GLM-5.2周卡，7天有效，3500次以上大模型请求，可接入各类编程工具。',
        price: '¥ 24.15',
        priceNum: 24.15,
        inStock: 1,
        stockText: '剩余51件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/tbk6gz'
      },
      {
        externalId: 'wzyp_tw28ot',
        shopCode: 'G062JE24',
        title: 'OpenAI与Claude中转20刀',
        category: '中转站',
        description: '1:1 额度卡，支持ChatGPT与Claude混合调用。',
        price: '¥ 20.00',
        priceNum: 20.0,
        inStock: 1,
        stockText: '剩余11件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/tw28ot'
      },
      {
        externalId: 'wzyp_jo14yg',
        shopCode: 'G062JE24',
        title: '智铺5.3月卡服务',
        category: '中转站',
        description: '智谱最新GLM-5.3月卡，30天有效，15000次以上大模型请求，量大管饱。',
        price: '¥ 104.50',
        priceNum: 104.5,
        inStock: 1,
        stockText: '剩余94件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/jo14yg'
      },
      {
        externalId: 'wzyp_mf6i6w',
        shopCode: 'G062JE24',
        title: '国产大模型 glm5.2 API 一亿token',
        category: '中转站',
        description: 'GLM-5.2 输入 1亿 Token，高并发调用，支持各类智能体对接。',
        price: '¥ 570.00',
        priceNum: 570.0,
        inStock: 1,
        stockText: '剩余3件',
        contact: '各类低价对接汇总',
        address: 'https://wzyp.cn/shop/G062JE24',
        sourceUrl: 'https://wzyp.cn/item/mf6i6w'
      }
    ];

    return shopService.upsertBatch(samples);
  }
}

export const scraperService = new ScraperService();
