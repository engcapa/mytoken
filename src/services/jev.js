import axios from 'axios';
import config from '../config/index.js';

/**
 * Parse proxy URL into axios proxy configuration object
 */
export function parseProxy(proxyUrl = '') {
  if (!proxyUrl) return false;
  try {
    const parsed = new URL(proxyUrl);
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80),
      auth: (parsed.username || parsed.password) ? {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password)
      } : undefined
    };
  } catch {
    return false;
  }
}

/**
 * TypeSafe Jev System One Decision Service
 * Jev is a high-speed, non-generative decision model designed for structured choices and browser automation
 * Official Endpoint: https://api.typesafe.ai/v1/systemone
 */
export class JevService {
  constructor(options = {}) {
    this.enabled = options.enabled !== undefined ? options.enabled : config.jev.enabled;
    this.apiKey = options.apiKey || config.jev.apiKey;
    this.baseUrl = options.baseUrl || config.jev.baseUrl || 'https://api.typesafe.ai/v1/systemone';
    this.model = options.model || config.jev.model || 'jev-latest';
    this.useProxy = options.useProxy !== undefined ? options.useProxy : (config.jev.useProxy || config.proxy.enabled);
    this.proxyUrl = options.proxyUrl || config.proxy.httpsProxy || config.proxy.httpProxy || config.proxy.allProxy || '';
  }

  /**
   * Update active settings dynamically at runtime
   */
  updateConfig({ enabled, apiKey, baseUrl, model, useProxy, proxyUrl } = {}) {
    if (enabled !== undefined) this.enabled = Boolean(enabled);
    if (apiKey !== undefined) this.apiKey = apiKey.trim();
    if (baseUrl !== undefined) this.baseUrl = baseUrl.trim();
    if (model !== undefined) this.model = model.trim();
    if (useProxy !== undefined) this.useProxy = Boolean(useProxy);
    if (proxyUrl !== undefined) this.proxyUrl = proxyUrl.trim();
  }

  /**
   * Get axios proxy configuration based on current settings
   */
  getAxiosProxyConfig() {
    if (!this.useProxy || !this.proxyUrl) return false;
    return parseProxy(this.proxyUrl);
  }

  /**
   * Low-level caller to TypeSafe Jev System One API
   * POST https://api.typesafe.ai/v1/systemone
   *
   * @param {Object} params
   * @param {string} params.state - Input context / DOM state / candidate text
   * @param {Object} params.questions - Dictionary of questions (choice, noul, score)
   * @param {string} [params.model] - Model name (defaults to 'jev-latest')
   */
  async callSystemOne({ state, questions, model = this.model }) {
    if (!this.apiKey) {
      throw new Error('TypeSafe Jev API Key is not configured. Please set JEV_API_KEY in .env or via settings.');
    }

    const payload = {
      model: model || this.model || 'jev-latest',
      state: typeof state === 'string' ? state : JSON.stringify(state),
      questions
    };

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'mytoken-scraper/1.0'
    };

    const proxyConfig = this.getAxiosProxyConfig();
    const startTime = Date.now();

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers,
        proxy: proxyConfig,
        timeout: 12000,
        validateStatus: () => true
      });

      const latencyMs = Date.now() - startTime;

      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication failed (HTTP ${response.status}): Please verify your TypeSafe Jev API Key.`);
      }

      if (response.status >= 400) {
        const errorDetail = response.data?.error || response.data?.message || JSON.stringify(response.data);
        throw new Error(`TypeSafe Jev API error (HTTP ${response.status}): ${errorDetail}`);
      }

      return {
        success: true,
        answers: response.data?.answers || {},
        usage: response.data?.usage || {},
        model: response.data?.model || this.model,
        latencyMs,
        raw: response.data
      };
    } catch (err) {
      if (err.response) {
        throw new Error(`TypeSafe Jev API error (HTTP ${err.response.status}): ${err.response.data?.message || err.message}`);
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        throw new Error(`Failed to connect to TypeSafe Jev at ${this.baseUrl} (${err.code}). Please check network or proxy settings.`);
      }
      throw err;
    }
  }

  /**
   * Test connection to TypeSafe Jev endpoint
   */
  async testConnection({ apiKey = this.apiKey, baseUrl = this.baseUrl, proxyUrl = this.proxyUrl, useProxy = this.useProxy } = {}) {
    const key = apiKey || this.apiKey;
    if (!key) {
      return { success: false, message: 'TypeSafe Jev API Key 为空，请先配置 API Key。' };
    }

    const prevKey = this.apiKey;
    const prevBase = this.baseUrl;
    const prevProxy = this.proxyUrl;
    const prevUseProxy = this.useProxy;

    this.apiKey = key;
    if (baseUrl) this.baseUrl = baseUrl;
    if (proxyUrl) this.proxyUrl = proxyUrl;
    if (useProxy !== undefined) this.useProxy = useProxy;

    try {
      const res = await this.callSystemOne({
        state: 'Connection probe from wzyp multi-shop scraper agent.',
        questions: {
          probe: {
            type: 'noul',
            instructions: 'Is this a valid healthcheck probe request?'
          }
        }
      });

      return {
        success: true,
        message: `TypeSafe Jev 服务连接正常！耗时: ${res.latencyMs}ms，模型: ${res.model}`,
        latencyMs: res.latencyMs,
        model: res.model
      };
    } catch (err) {
      return {
        success: false,
        message: `连接失败: ${err.message}`
      };
    } finally {
      this.apiKey = prevKey;
      this.baseUrl = prevBase;
      this.proxyUrl = prevProxy;
      this.useProxy = prevUseProxy;
    }
  }

  /**
   * Help the scraper determine which DOM element / selector represents the product items list
   * Inspired by browser-use/jev-ultrafast's Indexed Action Space
   *
   * @param {Array<Object>} candidates - List of candidate container objects:
   *   [{ id: 'cand_1', selector: '.goods_item', count: 11, sampleText: '...' }, ...]
   */
  async judgeProductContainers(candidates = []) {
    if (!this.enabled || !this.apiKey || candidates.length === 0) {
      return null;
    }

    const criteriaMap = {};
    const formattedCandidates = candidates.map((c, idx) => {
      const id = `cand_${idx + 1}`;
      const summary = `Selector "${c.selector}" matching ${c.count} elements. Sample snippet: "${(c.sampleText || '').slice(0, 100)}"`;
      criteriaMap[id] = summary;
      return `[${id}] ${summary}`;
    }).join('\n');

    const state = `Web page DOM analysis: The page contains ${candidates.length} candidate element groups that might be e-commerce product listings:\n\n${formattedCandidates}`;

    try {
      const result = await this.callSystemOne({
        state,
        questions: {
          best_candidate: {
            type: 'choice',
            instructions: 'Which candidate selector is the genuine product cards/listing container displaying salable goods, prices, and stock?',
            criteria: criteriaMap
          },
          is_shop_page: {
            type: 'noul',
            instructions: 'Does this page show real e-commerce shop products rather than an empty page or error barrier?'
          }
        }
      });

      const bestChoice = result.answers?.best_candidate?.choice;
      const confidence = result.answers?.best_candidate?.confidence || 0;
      const isShop = result.answers?.is_shop_page?.noul > 0.5;

      const chosenCandidate = candidates.find((_, idx) => `cand_${idx + 1}` === bestChoice) || candidates[0];

      return {
        chosenCandidate,
        selector: chosenCandidate?.selector,
        confidence,
        isShop,
        probabilities: result.answers?.best_candidate?.probabilities || {}
      };
    } catch (err) {
      console.warn('[JevService] judgeProductContainers error:', err.message);
      return null;
    }
  }

  /**
   * Browser-Use Style: Determine the next navigation / extraction action
   * Based on the indexed interactive controls table from browser-use/jev-ultrafast
   *
   * @param {Array<Object>} indexedControls - [{ id: 1, tag: 'BUTTON', text: '下一页', role: 'pagination' }, ...]
   * @param {string} goal - Target goal description
   */
  async judgeBrowserAction(indexedControls = [], goal = 'Locate in-stock products and navigate through category tabs') {
    if (!this.enabled || !this.apiKey || indexedControls.length === 0) {
      return null;
    }

    const state = `Browser Agent State:\nCurrent Goal: ${goal}\nIndexed Interactive Controls on Current Page:\n` +
      indexedControls.slice(0, 25).map(c => `[ID ${c.id}] <${c.tag}> text="${c.text}" (role: ${c.role || 'none'})`).join('\n');

    try {
      const result = await this.callSystemOne({
        state,
        questions: {
          action: {
            type: 'choice',
            instructions: 'What is the optimal next browser action to discover more products?',
            criteria: {
              EXTRACT_ITEMS: 'Current view contains visible products that are ready to extract now',
              SWITCH_TAB: 'Click an unvisited category tab to load more products into view',
              NEXT_PAGE: 'Click the pagination / next page button to load the next set of items',
              WAIT_OR_DONE: 'All categories and items are already loaded or no further action needed'
            }
          }
        }
      });

      return {
        action: result.answers?.action?.choice,
        confidence: result.answers?.action?.confidence || 0
      };
    } catch (err) {
      console.warn('[JevService] judgeBrowserAction error:', err.message);
      return null;
    }
  }

  /**
   * Judge whether an HTML snippet is an Alibaba Cloud ESA / Cloudflare CAPTCHA slider challenge
   */
  async isWafOrCaptcha(htmlSnippet = '') {
    if (!this.enabled || !this.apiKey || !htmlSnippet) {
      return false;
    }

    try {
      const result = await this.callSystemOne({
        state: htmlSnippet.slice(0, 800),
        questions: {
          is_captcha: {
            type: 'noul',
            instructions: 'Is this webpage response showing a CAPTCHA verification challenge, bot verification slider, or WAF block screen?'
          }
        }
      });

      return result.answers?.is_captcha?.noul > 0.6;
    } catch {
      return false;
    }
  }

  /**
   * Harmonize and normalize a merchant's shop category into a standardized canonical category
   * Uses Jev System One choice decision with fallback heuristic
   *
   * @param {Object} params
   * @param {string} params.shopCode - Shop code (e.g. 'FT7')
   * @param {string} params.rawCategory - Merchant's raw category (e.g. 'G Plus')
   * @param {Array<string>} [params.sampleTitles] - Array of sample product titles
   * @param {Object} [params.customCategories] - Custom canonical categories map
   */
  async normalizeCategory({ shopCode = '', rawCategory = '', sampleTitles = [], customCategories = null }) {
    const categoriesMap = customCategories || DEFAULT_CANONICAL_CATEGORIES;
    const cleanRaw = (rawCategory || '').trim();
    if (!cleanRaw) {
      return { canonicalCategory: '网络与综合服务', confidence: 1.0, source: 'fallback' };
    }

    // If Jev is not enabled or no apiKey configured, fallback to heuristic rules
    if (!this.enabled || !this.apiKey) {
      const fallbackCat = heuristicCategorize(cleanRaw, sampleTitles);
      return {
        canonicalCategory: fallbackCat,
        confidence: 0.85,
        source: 'heuristic'
      };
    }

    const titlesList = sampleTitles.length > 0 
      ? sampleTitles.map((t, idx) => `  ${idx + 1}. ${t}`).join('\n')
      : '  (暂无样本标题)';

    const state = `E-commerce Category Harmonization Task:\n` +
      `Platform: wzyp.cn Multi-Shop Showcase\n` +
      `Shop Code: ${shopCode || 'Unknown'}\n` +
      `Merchant Raw Category: "${cleanRaw}"\n` +
      `Sample Product Titles:\n${titlesList}`;

    try {
      const result = await this.callSystemOne({
        state,
        questions: {
          canonical_category: {
            type: 'choice',
            instructions: 'Which standard canonical category best describes this shop category? Follow these guidelines: 1) Give primary priority to the Category Name: if name contains "邮箱" or "mail" -> "邮箱与账号体系"; if name contains "接码" or "接马" -> "手机接码与验证"; if name is "G Plus", "G K12 Team", or "OpenAI" -> "ChatGPT / OpenAI"; if name contains "谷歌" or "Gemini" -> "Google Gemini"; if name contains "Claude" or "grok" -> "Anthropic Claude"; if name contains "中转" -> "API 中转与算力". 2) Only when the Category Name is generic (like "其他|各种类型") use the sample product titles to decide.',
            criteria: categoriesMap
          }
        }
      });

      const choice = result.answers?.canonical_category?.choice;
      const confidence = result.answers?.canonical_category?.confidence || 0.9;

      if (choice && categoriesMap[choice]) {
        return {
          canonicalCategory: choice,
          confidence,
          source: 'jev'
        };
      }

      // Fallback if choice didn't match
      const fallbackCat = heuristicCategorize(cleanRaw, sampleTitles);
      return {
        canonicalCategory: fallbackCat,
        confidence: 0.8,
        source: 'heuristic_fallback'
      };
    } catch (err) {
      console.warn(`[JevService] normalizeCategory error for [${shopCode}] "${cleanRaw}":`, err.message);
      const fallbackCat = heuristicCategorize(cleanRaw, sampleTitles);
      return {
        canonicalCategory: fallbackCat,
        confidence: 0.75,
        source: 'heuristic_error_fallback'
      };
    }
  }

  /**
   * Harmonize all categories across all shops in database
   *
   * @param {Object} shopService - Database shopService instance
   * @param {Object} options
   * @param {boolean} [options.forceAll=false] - Whether to re-classify already mapped categories
   */
  async harmonizeAllCategories(shopService, { forceAll = false } = {}) {
    const distinctCategories = shopService.getDistinctShopCategories();
    const results = [];
    let updatedCount = 0;

    for (const item of distinctCategories) {
      const { shop_code, raw_category, canonical_category } = item;
      
      // If already mapped and not forcing re-classification, keep existing
      if (!forceAll && canonical_category) {
        results.push({
          shopCode: shop_code,
          rawCategory: raw_category,
          canonicalCategory: canonical_category,
          source: item.source || 'cached',
          confidence: item.confidence || 1.0,
          updated: false
        });
        continue;
      }

      // Fetch sample titles for context
      const sampleRows = shopService.getCategorySampleTitles(shop_code, raw_category, 5);
      const sampleTitles = sampleRows.map(r => r.title);

      const decision = await this.normalizeCategory({
        shopCode: shop_code,
        rawCategory: raw_category,
        sampleTitles
      });

      // Save mapping to database and update shops
      shopService.saveCategoryMapping({
        shopCode: shop_code,
        rawCategory: raw_category,
        canonicalCategory: decision.canonicalCategory,
        confidence: decision.confidence,
        source: decision.source
      });

      updatedCount++;
      results.push({
        shopCode: shop_code,
        rawCategory: raw_category,
        canonicalCategory: decision.canonicalCategory,
        source: decision.source,
        confidence: decision.confidence,
        updated: true
      });
    }

    // Also perform per-product title + description classification
    let productUpdated = 0;
    if (typeof shopService.classifyAllProducts === 'function') {
      productUpdated = shopService.classifyAllProducts();
      console.log(`[Harmonization] Completed per-product classification for ${productUpdated} items.`);
    }

    return {
      totalCategories: distinctCategories.length,
      updatedCount,
      productUpdated,
      mappings: results
    };
  }
}

/**
 * Standard Canonical Categories for AI Token & Digital Goods
 */
export const DEFAULT_CANONICAL_CATEGORIES = {
  'OpenAI': 'ChatGPT、GPT-4o、OpenAI账号、G Plus、Plus充值、Team团队号、Codex、Free账号等OpenAI官方体系',
  'Google': 'Gemini、Gemini Pro、Gemini Advanced、Google One 2TB、反重力、谷歌老邮箱与官方账户服务',
  'Grok (x.ai)': 'Grok 2、x.ai、X Premium会员、Twitter Premium、gro充值与成品号',
  'Anthropic': 'Claude 3.5 Sonnet、Opus、Claude Pro、Claude Team、Claude速刷/5X/20X与Anthropic账户体系',
  'Kiro (AWS)': 'Kiro、AWS账户、Amazon Bedrock、AWS配额与亚马逊云端算力服务',
  '手机接码': '手机接码、接马、短信验证码、一次性API验证码、长效/短效手机接马、实体卡代收',
  '虚拟信用卡': '虚拟信用卡、VISA卡、Mastercard、万事达、开卡激活、VCC与海外支付卡',
  '国产模型': 'DeepSeek、智谱GLM、通义千问Qwen、文心一言、Kimi月之暗面、MiniMax、混元、豆包等国产模型服务',
  'API 中转与算力': '大模型API中转、1刀/10刀/20刀额度卡、OneAPI/NewAPI、混合算力兑换',
  'AI 编程与工具': 'Cursor、GitHub Copilot、Windsurf、Midjourney、Runway、Suno、Perplexity、Capcut等编程与AI工具',
  '邮箱与社交账号': 'Outlook、Hotmail、微软邮箱、iCloud、Apple ID、教育邮箱、Telegram、TikTok、WhatsApp、FB账号',
  '网络与综合服务': '节点加速、梯子、工具卡密、综合教程与相关外围配套服务'
};

/**
 * High-precision product classifier based on title + description + raw category
 */
export function identifyProductCategory({ title = '', description = '', category = '', shopCode = '' } = {}) {
  const cleanTitle = (title || '').toLowerCase();
  const cleanCategory = (category || '').toLowerCase();
  const primaryText = `${cleanTitle} ${cleanCategory}`;
  // Limit description to prevent irrelevant matching from lengthy tutorial text
  const fullText = `${cleanTitle} ${cleanCategory} ${(description || '').slice(0, 300).toLowerCase()}`;

  function matchRules(text) {
    // 1. 虚拟信用卡 (VISA, Mastercard, VCC, 485954)
    if (
      /虚拟卡|虚拟信用卡|信用卡|visa|mastercard|万事达|vcc|485954|556150|428837/.test(text) &&
      !/支持visa|支持信用卡|visa支付|非信用卡/.test(text) &&
      !/figma/.test(cleanTitle) &&
      !/g plus|g pro|openai/.test(cleanTitle)
    ) {
      return '虚拟信用卡';
    }

    // Dedicated SMS categories
    const isSmsCategory = /短效手机接马|长效手机接马|手机接马|手机接码|codex 接马|codex手机接马/.test(cleanCategory);

    // Is this an account where '接马' is merely a status flag?
    const isAccountDesc = (
      /未接马|未接码|免接马|免接码|已接马|已接码/.test(text) &&
      /账号|成品|free号|free|plus|team|rt|反代|质保|账密|代发|格式发货|非分裂|老号|月卡|独享/.test(text) &&
      !/单次|一次性|换号|代收|代接|长效接|短效接|接码服务|接马服务|接验证码|包接|来码|卡密|实卡/.test(text)
    ) || cleanCategory.includes('已接马可反代');

    // 2. 手机接码 (SMS Verification, even for Claude/Codex/Google)
    if (
      (isSmsCategory && !/反代专用|成品号/.test(cleanTitle)) ||
      (!isAccountDesc && /单次接马|一次性接马|长效接马|短效接马|单次接码|一次性接码|代收验证码|短信验证|一次性api验证码|手机接马|手机接码|接马服务|接码服务|接验证码|自助换号|包接马|包来码|实体号池|接ma|验证码卡密/.test(text))
    ) {
      return '手机接码';
    }

    // 3. Kiro (AWS)
    if (/(?:^|[^a-zA-Z])kiro(?:[^a-zA-Z]|$)|aws|amazon|bedrock|亚马逊|aws8v|aws32v/.test(text)) {
      return 'Kiro (AWS)';
    }

    // 4. Grok (x.ai)
    if (/grok|g\.rok|gro k|x\.ai|xai|x premium|twitter premium|gro 充值|gro 成品|gro普号|gr0k|x平台会员/.test(text)) {
      return 'Grok (x.ai)';
    }

    // 5. Anthropic (Claude)
    if (/claude|anthropic|sonnet|opus|haiku|claude pro|claude team|claude速刷|claude 5x|claude 20x|claude普号|claude k12|克劳德/.test(text)) {
      return 'Anthropic';
    }

    // 6. 国产模型 (DeepSeek, 智谱GLM, 通义千问, 文心, Kimi, 混元, 豆包, MiniMax等)
    // Only match when title or category explicitly mentions domestic model
    if (
      /deepseek|智谱|glm|智铺|通义千问|qwen|文心一言|文心|kimi|月之暗面|moonshot|混元|hunyuan|豆包|doubao|minimax|阶跃星辰|stepfun|百川|baichuan|商汤|日日新/.test(cleanTitle) ||
      /deepseek|智谱|国产模型/.test(cleanCategory)
    ) {
      return '国产模型';
    }

    // 7. OpenAI (Priority over pure Google/email when title indicates OpenAI Team/Plus/GPT/Codex)
    const isOpenAiAccount = (
      /openai|chatgpt|gpt-4|gpt-3|gpt4|gpt3|gpt|gp t|g plus|plus|codex|o1-preview|o1-mini|o3|sora|2fa|首车|新车|炸车|rt有帐密|team|g free|free账号|free成品|g皮踢|已接马|未接马/.test(text) ||
      /g plus|openai free|gp t-free账号|g free|team 5x/.test(cleanCategory) ||
      isAccountDesc
    );
    if (isOpenAiAccount) {
      return 'OpenAI';
    }

    // 8. Google (Gemini, Google One, Google accounts)
    if (/gemini|谷歌|google|google one|gdrive|反重力|google老邮箱|谷歌老邮箱|谷歌邮箱|k12谷歌/.test(text)) {
      return 'Google';
    }

    // 9. API 中转与算力 (纯中转站、1刀额度卡等)
    if (/中转|中转站|oneapi|newapi|额度卡|api额度|算力|1刀|10刀|20刀/.test(text)) {
      return 'API 中转与算力';
    }

    // 10. AI 编程与工具 (Cursor, Copilot, Midjourney, Perplexity, Automation, etc.)
    if (
      /cursor|copilot|windsurf|midjourney|suno|runway|luma|kling|快手|capcut|剪映|perplexity|figma|视频ai|绘画|ai写作/.test(text) ||
      /自动化|助手|采集|多开|工具卡密/.test(text)
    ) {
      return 'AI 编程与工具';
    }

    // 11. 邮箱与社交账号 (Outlook, Hotmail, iCloud, Apple ID, TG, WhatsApp, Ins, etc.)
    if (/邮箱|mail|outlook|hotmail|icloud|apple id|苹果id|教育邮箱|edu|tg号|telegram|tiktok|whatsapp|领英|facebook|推特|x账号/.test(text)) {
      return '邮箱与社交账号';
    }

    return null;
  }

  // 1. High confidence: evaluate Title + Raw Category first
  const primaryResult = matchRules(primaryText);
  if (primaryResult) return primaryResult;

  // 2. Secondary fallback: evaluate Description
  const fullResult = matchRules(fullText);
  if (fullResult) return fullResult;

  // 3. Fallback
  return '网络与综合服务';
}

/**
 * Heuristic fallback categorizer
 */
export function heuristicCategorize(rawCategory = '', sampleTitles = []) {
  if (sampleTitles.length > 0) {
    const votes = {};
    for (const title of sampleTitles) {
      const cat = identifyProductCategory({ title, category: rawCategory });
      votes[cat] = (votes[cat] || 0) + 1;
    }
    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      return sorted[0][0];
    }
  }
  return identifyProductCategory({ title: '', category: rawCategory });
}

export const jevService = new JevService();
export default jevService;
