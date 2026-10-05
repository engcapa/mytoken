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
}

export const jevService = new JevService();
export default jevService;
