// Frontend Application State
const state = {
  page: 1,
  limit: 100,
  search: '',
  category: '',
  shopCode: '',
  inStockOnly: true,
  sortBy: 'price_asc',
  totalPages: 1,
  isScraping: false
};

// DOM Elements
const productsListView = document.getElementById('products-list-view');
const emptyState = document.getElementById('empty-state');
const paginationBar = document.getElementById('pagination-bar');
const pageIndicator = document.getElementById('page-indicator');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const searchInput = document.getElementById('search-input');
const categoryPills = document.getElementById('category-pills');
const shopSelect = document.getElementById('shop-select');
const toggleInStock = document.getElementById('toggle-instock');
const btnScrape = document.getElementById('btn-scrape');
const scrapeIcon = document.getElementById('scrape-icon');
const scrapeText = document.getElementById('scrape-text');
const btnInteractive = document.getElementById('btn-interactive');
const interactiveIcon = document.getElementById('interactive-icon');
const interactiveText = document.getElementById('interactive-text');
const btnSeed = document.getElementById('btn-seed');
const btnConfig = document.getElementById('btn-config');
const btnSaveConfig = document.getElementById('btn-save-config');
const cfgTargetShops = document.getElementById('cfg-target-shops');
const cfgWafCookie = document.getElementById('cfg-waf-cookie');
const noticeBanner = document.getElementById('notice-banner');
const noticeClose = document.getElementById('notice-close');

// Jev & Proxy DOM Elements
const tabBtnShops = document.getElementById('tab-btn-shops');
const tabBtnJev = document.getElementById('tab-btn-jev');
const tabBtnMappings = document.getElementById('tab-btn-mappings');
const tabContentShops = document.getElementById('tab-content-shops');
const tabContentJev = document.getElementById('tab-content-jev');
const tabContentMappings = document.getElementById('tab-content-mappings');
const btnHarmonize = document.getElementById('btn-harmonize');
const btnModalHarmonize = document.getElementById('btn-modal-harmonize');
const cfgJevEnabled = document.getElementById('cfg-jev-enabled');
const cfgJevKey = document.getElementById('cfg-jev-key');
const cfgJevBaseUrl = document.getElementById('cfg-jev-base-url');
const cfgJevModel = document.getElementById('cfg-jev-model');
const cfgUseProxy = document.getElementById('cfg-use-proxy');
const cfgProxyUrl = document.getElementById('cfg-proxy-url');
const btnToggleKeyVis = document.getElementById('btn-toggle-key-vis');
const btnTestJev = document.getElementById('btn-test-jev');
const testJevText = document.getElementById('test-jev-text');
const testJevResult = document.getElementById('test-jev-result');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  restoreConfig();
  loadStats();
  loadCategories();
  loadShopCodes();
  loadProducts();
  bindEvents();
});

// Event Binding
function bindEvents() {
  // Search input with debounce
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page = 1;
      loadProducts();
    }, 300);
  });

  // In-Stock toggle
  toggleInStock.addEventListener('change', (e) => {
    state.inStockOnly = e.target.checked;
    state.page = 1;
    loadProducts();
  });

  // Shop filter change
  shopSelect.addEventListener('change', (e) => {
    state.shopCode = e.target.value;
    state.page = 1;
    loadProducts();
  });

  // Pagination
  btnPrevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      loadProducts();
    }
  });

  btnNextPage.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      loadProducts();
    }
  });

  // Scrape actions
  btnScrape.addEventListener('click', () => handleScrape({ interactive: false }));
  btnInteractive.addEventListener('click', () => handleScrape({ interactive: true }));

  // Harmonize categories action
  if (btnHarmonize) {
    btnHarmonize.addEventListener('click', () => handleHarmonizeCategories({ forceAll: true }));
  }
  if (btnModalHarmonize) {
    btnModalHarmonize.addEventListener('click', () => handleHarmonizeCategories({ forceAll: true }));
  }

  // Seed sample action
  btnSeed.addEventListener('click', handleSeed);

  // Config Modal
  btnConfig.addEventListener('click', () => {
    openModal('modal-config');
    loadCategoryMappings();
  });
  btnSaveConfig.addEventListener('click', saveConfig);

  // Notice close
  noticeClose.addEventListener('click', () => noticeBanner.classList.add('hidden'));

  // Settings Tabs
  if (tabBtnShops) tabBtnShops.addEventListener('click', () => switchSettingsTab('shops'));
  if (tabBtnJev) tabBtnJev.addEventListener('click', () => switchSettingsTab('jev'));
  if (tabBtnMappings) tabBtnMappings.addEventListener('click', () => switchSettingsTab('mappings'));

  // Toggle API key visibility
  if (btnToggleKeyVis && cfgJevKey) {
    btnToggleKeyVis.addEventListener('click', () => {
      if (cfgJevKey.type === 'password') {
        cfgJevKey.type = 'text';
        btnToggleKeyVis.textContent = '隐藏';
      } else {
        cfgJevKey.type = 'password';
        btnToggleKeyVis.textContent = '显示';
      }
    });
  }

  // Test Jev connection button
  if (btnTestJev) {
    btnTestJev.addEventListener('click', handleTestJev);
  }
}

// Switch modal tabs
function switchSettingsTab(tabName) {
  const tabs = [
    { name: 'shops', btn: tabBtnShops, content: tabContentShops },
    { name: 'jev', btn: tabBtnJev, content: tabContentJev },
    { name: 'mappings', btn: tabBtnMappings, content: tabContentMappings }
  ];

  tabs.forEach(t => {
    if (!t.btn || !t.content) return;
    if (t.name === tabName) {
      t.btn.className = 'tab-btn active px-4 py-2 border-b-2 border-indigo-600 text-indigo-600 transition-colors';
      t.content.classList.remove('hidden');
    } else {
      t.btn.className = 'tab-btn px-4 py-2 border-b-2 border-transparent text-slate-500 hover:text-slate-700 transition-colors';
      t.content.classList.add('hidden');
    }
  });

  if (tabName === 'mappings') {
    loadCategoryMappings();
  }
}

// Restore saved settings
async function restoreConfig() {
  const defaultShops = 'https://wzyp.cn/shop/FT7\nhttps://wzyp.cn/shop/G062JE24';
  const savedShops = localStorage.getItem('scraper_target_shops') || defaultShops;
  const savedCookie = localStorage.getItem('scraper_waf_cookie') || '';
  if (cfgTargetShops) cfgTargetShops.value = savedShops;
  if (cfgWafCookie) cfgWafCookie.value = savedCookie;

  // Restore Jev and Proxy configurations from server
  try {
    const res = await fetch('/api/jev/config');
    const json = await res.json();
    if (json.success && json.data) {
      if (cfgJevEnabled) cfgJevEnabled.checked = json.data.enabled;
      if (cfgJevBaseUrl) cfgJevBaseUrl.value = json.data.baseUrl || 'https://api.typesafe.ai/v1/systemone';
      if (cfgJevModel) cfgJevModel.value = json.data.model || 'jev-latest';
      if (cfgUseProxy) cfgUseProxy.checked = json.data.useProxy;
      if (cfgProxyUrl) cfgProxyUrl.value = json.data.proxyUrl || '';
      if (json.data.hasKey && cfgJevKey) {
        cfgJevKey.placeholder = `已配置密钥 (${json.data.maskedKey})，留空不修改`;
      }
    }
  } catch (err) {
    console.warn('Failed to load Jev config from server:', err);
  }
}

// Save settings
async function saveConfig() {
  const shops = cfgTargetShops.value.trim();
  const cookie = cfgWafCookie.value.trim();
  localStorage.setItem('scraper_target_shops', shops);
  localStorage.setItem('scraper_waf_cookie', cookie);

  // Save Jev and Proxy settings to server
  const jevPayload = {
    enabled: cfgJevEnabled ? cfgJevEnabled.checked : false,
    baseUrl: cfgJevBaseUrl ? cfgJevBaseUrl.value.trim() : '',
    model: cfgJevModel ? cfgJevModel.value.trim() : 'jev-latest',
    useProxy: cfgUseProxy ? cfgUseProxy.checked : false,
    proxyUrl: cfgProxyUrl ? cfgProxyUrl.value.trim() : ''
  };

  const keyInput = cfgJevKey ? cfgJevKey.value.trim() : '';
  if (keyInput) {
    jevPayload.apiKey = keyInput;
  }

  try {
    const res = await fetch('/api/jev/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jevPayload)
    });
    const result = await res.json();
    if (result.success) {
      showToast('💾 系统管理配置已保存，Jev 与代理设置已实时生效！');
      if (cfgJevKey && keyInput) {
        cfgJevKey.value = '';
        cfgJevKey.placeholder = `已更新密钥 (${keyInput.slice(0, 4)}...${keyInput.slice(-4)})`;
      }
    } else {
      showToast('⚠️ 配置已部分保存，但 Jev 服务端更新异常: ' + result.error);
    }
  } catch (err) {
    showToast('💾 本地小铺配置已保存！服务端通讯异常: ' + err.message);
  }

  closeModal('modal-config');
}

// Test TypeSafe Jev API connection
async function handleTestJev() {
  if (!btnTestJev) return;

  btnTestJev.disabled = true;
  testJevText.textContent = '连接测试中...';
  testJevResult.className = 'mt-2 p-2 rounded-lg text-[11px] bg-slate-100 text-slate-700 block';
  testJevResult.textContent = '正在向 TypeSafe Jev API 发送探测请求 (POST /v1/systemone)...';

  const payload = {
    baseUrl: cfgJevBaseUrl ? cfgJevBaseUrl.value.trim() : '',
    useProxy: cfgUseProxy ? cfgUseProxy.checked : false,
    proxyUrl: cfgProxyUrl ? cfgProxyUrl.value.trim() : ''
  };

  const keyInput = cfgJevKey ? cfgJevKey.value.trim() : '';
  if (keyInput) {
    payload.apiKey = keyInput;
  }

  try {
    const res = await fetch('/api/jev/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      testJevResult.className = 'mt-2 p-2.5 rounded-lg text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 block';
      testJevResult.innerHTML = `✅ <strong>连接成功！</strong> ${escapeHtml(json.message)} (模型: ${escapeHtml(json.model || 'jev-latest')})`;
    } else {
      testJevResult.className = 'mt-2 p-2.5 rounded-lg text-[11px] bg-red-50 text-red-700 border border-red-200 block';
      testJevResult.innerHTML = `❌ <strong>连接失败：</strong> ${escapeHtml(json.message)}`;
    }
  } catch (err) {
    testJevResult.className = 'mt-2 p-2.5 rounded-lg text-[11px] bg-red-50 text-red-700 border border-red-200 block';
    testJevResult.innerHTML = `❌ <strong>请求发生错误：</strong> ${escapeHtml(err.message)}`;
  } finally {
    btnTestJev.disabled = false;
    testJevText.textContent = '测试 TypeSafe Jev 连通性';
  }
}

// Jev Category Harmonization Action
async function handleHarmonizeCategories({ forceAll = false } = {}) {
  const harmonizeIcon = document.getElementById('harmonize-icon');
  const harmonizeText = document.getElementById('harmonize-text');
  const modalHarmonizeIcon = document.getElementById('modal-harmonize-icon');
  const modalHarmonizeText = document.getElementById('modal-harmonize-text');

  if (btnHarmonize) btnHarmonize.disabled = true;
  if (btnModalHarmonize) btnModalHarmonize.disabled = true;
  if (harmonizeIcon) harmonizeIcon.textContent = '⏳';
  if (harmonizeText) harmonizeText.textContent = 'Jev 归类中...';
  if (modalHarmonizeIcon) modalHarmonizeIcon.textContent = '⏳';
  if (modalHarmonizeText) modalHarmonizeText.textContent = '正在通过 Jev 模型决策中...';

  showToast('🤖 正在通过 TypeSafe Jev 模型计算分类相似度并归一化...');

  try {
    const res = await fetch('/api/jev/harmonize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceAll })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`🎉 ${json.message || 'Jev 智能统一分类完成！'}`);
      await Promise.all([
        loadStats(),
        loadCategories(),
        loadShopCodes(),
        loadProducts(),
        loadCategoryMappings()
      ]);
    } else {
      showToast('❌ 统一分类失败: ' + (json.error || '未知错误'));
    }
  } catch (err) {
    showToast('❌ 请求失败: ' + err.message);
  } finally {
    if (btnHarmonize) btnHarmonize.disabled = false;
    if (btnModalHarmonize) btnModalHarmonize.disabled = false;
    if (harmonizeIcon) harmonizeIcon.textContent = '🤖';
    if (harmonizeText) harmonizeText.textContent = 'Jev 智能统一分类';
    if (modalHarmonizeIcon) modalHarmonizeIcon.textContent = '🤖';
    if (modalHarmonizeText) modalHarmonizeText.textContent = '重新执行 Jev 智能归类';
  }
}

// Load category mappings for settings modal
async function loadCategoryMappings() {
  const tbody = document.getElementById('mappings-table-body');
  if (!tbody) return;

  try {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400">正在加载最新分类映射...</td></tr>`;
    const res = await fetch('/api/jev/categories');
    const json = await res.json();
    if (json.success && json.data) {
      const distinct = json.data.distinctList || [];
      if (distinct.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400">暂无小铺分类数据，请先抓取商品。</td></tr>`;
        return;
      }

      tbody.innerHTML = distinct.map(item => `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-2.5 px-3">
            <span class="font-mono font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded text-[11px] border border-purple-100">
              ${escapeHtml(item.shop_code || 'wzyp')}
            </span>
          </td>
          <td class="py-2.5 px-3 font-medium text-slate-800">
            ${escapeHtml(item.raw_category)}
          </td>
          <td class="py-2.5 px-3">
            ${item.canonical_category ? `
              <span class="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded text-[11px]">
                <span>🏷️</span>
                <span>${escapeHtml(item.canonical_category)}</span>
              </span>
            ` : `
              <span class="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[11px]">未归类</span>
            `}
          </td>
          <td class="py-2.5 px-2 text-[11px] text-slate-500 font-mono">
            ${item.confidence ? `${Math.round(item.confidence * 100)}%` : '-'}
            <span class="text-[10px] text-slate-400">(${escapeHtml(item.source || 'jev')})</span>
          </td>
          <td class="py-2.5 px-2 text-right pr-3 font-semibold text-slate-700">
            ${item.count} 件
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-500">加载映射失败: ${err.message}</td></tr>`;
  }
}

// Load Statistics
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (json.success) {
      document.getElementById('stat-instock').textContent = json.data.inStockCount || 0;
      document.getElementById('stat-categories').textContent = json.data.categoriesCount || 0;
      document.getElementById('stat-shops').textContent = json.data.shopCodesCount || 0;
      
      const last = json.data.lastScrape;
      if (last) {
        const timeStr = new Date(last.created_at).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });
        const badge = last.status === 'SUCCESS' ? '🟢 成功' : (last.status === 'WAF_BLOCKED' ? '🟠 WAF拦截' : '🔴 失败');
        document.getElementById('stat-last-time').textContent = `${timeStr} (${badge})`;
      } else {
        document.getElementById('stat-last-time').textContent = '尚未抓取';
      }
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Load Categories
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const json = await res.json();
    if (json.success) {
      const categories = json.data || [];
      categoryPills.innerHTML = `
        <button class="cat-pill ${state.category === '' ? 'active bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" data-category="">全部品类</button>
      `;

      categories.forEach(item => {
        const activeClass = state.category === item.category ? 'active bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
        const btn = document.createElement('button');
        btn.className = `cat-pill ${activeClass} px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap`;
        btn.dataset.category = item.category;
        btn.innerHTML = `${escapeHtml(item.category)} <span class="opacity-60 text-[10px]">(${item.count})</span>`;
        categoryPills.appendChild(btn);
      });

      // Category pill click handler
      categoryPills.querySelectorAll('.cat-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          categoryPills.querySelectorAll('.cat-pill').forEach(b => {
            b.className = 'cat-pill bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap';
          });
          btn.className = 'cat-pill active bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap';
          state.category = btn.dataset.category;
          state.page = 1;
          loadProducts();
        });
      });
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

// Load Shop Codes dropdown
async function loadShopCodes() {
  try {
    const res = await fetch('/api/shop-codes');
    const json = await res.json();
    if (json.success) {
      const codes = json.data || [];
      const current = shopSelect.value;
      shopSelect.innerHTML = `<option value="">全部小铺 (All Shops)</option>`;
      codes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.shop_code;
        opt.textContent = `小铺: ${c.shop_code} (${c.count}件)`;
        if (c.shop_code === current) opt.selected = true;
        shopSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load shop codes:', err);
  }
}

// Load Products List (Grouped by Category & Sorted by Price Ascending)
async function loadProducts() {
  try {
    productsListView.innerHTML = `
      <div class="py-16 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
        <span class="inline-block animate-spin text-2xl mb-2">⏳</span>
        <p class="text-xs">加载在售商品数据中（价格由低到高）...</p>
      </div>
    `;

    const params = new URLSearchParams({
      page: state.page,
      limit: state.limit,
      search: state.search,
      category: state.category,
      shopCode: state.shopCode,
      inStockOnly: state.inStockOnly ? 'true' : 'false',
      sortBy: state.sortBy
    });

    const res = await fetch(`/api/shops?${params}`);
    const json = await res.json();

    if (!json.success || !json.data || json.data.items.length === 0) {
      productsListView.innerHTML = '';
      emptyState.classList.remove('hidden');
      paginationBar.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    renderProductsList(json.data.items);

    // Update pagination
    state.totalPages = json.data.pagination.totalPages;
    pageIndicator.textContent = `第 ${state.page} / ${state.totalPages} 页 (共 ${json.data.pagination.total} 件商品)`;
    btnPrevPage.disabled = state.page <= 1;
    btnNextPage.disabled = state.page >= state.totalPages;
    paginationBar.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load products:', err);
    productsListView.innerHTML = `<div class="py-8 text-center text-red-500 text-xs bg-white rounded-xl">加载失败: ${err.message}</div>`;
  }
}

// Render Products as Grouped Category Tables (No Cards!)
function renderProductsList(items) {
  productsListView.innerHTML = '';

  // Group items by canonical category (fallback to raw category)
  const groups = {};
  items.forEach(item => {
    const cat = item.canonical_category || item.category || '未分类专区';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  // Render each category group as a clean list table
  Object.keys(groups).forEach(catName => {
    const groupItems = groups[catName];
    // Each group is already sorted by price_num ASC from database
    const cardSection = document.createElement('div');
    cardSection.className = 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs';

    cardSection.innerHTML = `
      <!-- Category Group Header -->
      <div class="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="text-base">🏷️</span>
          <h2 class="font-bold text-slate-800 text-sm tracking-tight">${escapeHtml(catName)}</h2>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
            ${groupItems.length} 件在售 &bull; 跨小铺比价
          </span>
        </div>
        <div class="text-[11px] text-slate-500 font-medium flex items-center gap-1">
          <span>📶 价格从低到高排列</span>
        </div>
      </div>

      <!-- Table Content (No cards) -->
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="bg-slate-50/75 text-slate-500 border-b border-slate-200 text-[11px] font-semibold">
              <th class="py-3 px-5 w-5/12">商品名称与说明</th>
              <th class="py-3 px-4 w-2/12 whitespace-nowrap">价格 (低到高)</th>
              <th class="py-3 px-3 w-1/12 whitespace-nowrap">库存状态</th>
              <th class="py-3 px-3 w-1/12 whitespace-nowrap">所属小铺</th>
              <th class="py-3 px-4 w-2/12 whitespace-nowrap">联系 / 购买</th>
              <th class="py-3 px-4 w-1/12 text-right whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${groupItems.map(item => `
              <tr class="hover:bg-slate-50/80 transition-colors">
                <!-- Title & Description -->
                <td class="py-3 px-5 align-top">
                  <a href="${item.source_url || '#'}" target="_blank" class="font-bold text-slate-900 text-sm hover:text-indigo-600 transition-colors inline-block leading-snug" title="在新窗口打开具体商品详情">
                    ${escapeHtml(item.title)}
                  </a>
                  <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                    ${item.category ? `
                      <span class="inline-flex items-center text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-normal" title="小铺商户原始分类: ${escapeHtml(item.category)}">
                        商户原类: ${escapeHtml(item.category)}
                      </span>
                    ` : ''}
                    ${item.canonical_category ? `
                      <span class="inline-flex items-center text-[10px] text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded font-medium" title="经 Jev 语义决策模型智能归一化">
                        🤖 Jev智能归类
                      </span>
                    ` : ''}
                  </div>
                  ${item.description ? `
                    <div class="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                      ${escapeHtml(item.description)}
                    </div>
                  ` : ''}
                </td>

                <!-- Price -->
                <td class="py-3 px-4 align-top whitespace-nowrap">
                  <div class="text-sm font-extrabold text-emerald-700">
                    ${escapeHtml(item.price || (item.price_num ? `¥ ${item.price_num.toFixed(2)}` : '询价'))}
                  </div>
                </td>

                <!-- Stock Status -->
                <td class="py-3 px-3 align-top whitespace-nowrap">
                  ${item.in_stock ? `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      ${escapeHtml(item.stock_text || '有货')}
                    </span>
                  ` : `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                      <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                      缺货
                    </span>
                  `}
                </td>

                <!-- Shop Code -->
                <td class="py-3 px-3 align-top whitespace-nowrap">
                  <a href="https://wzyp.cn/shop/${encodeURIComponent(item.shop_code || '')}" target="_blank" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 font-mono transition-colors" title="查看小铺 ${escapeHtml(item.shop_code)} 主页">
                    <span>🏪</span>
                    <span>${escapeHtml(item.shop_code || 'wzyp')}</span>
                  </a>
                </td>

                <!-- Contact & Buy Link -->
                <td class="py-3 px-4 align-top text-xs text-slate-600 whitespace-nowrap">
                  ${item.source_url ? `
                    <a href="${item.source_url}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md font-medium text-xs transition-colors shadow-2xs" title="直达该商品的具体购买详情页">
                      <span>直达商品 ↗</span>
                    </a>
                  ` : `
                    <span class="text-slate-400">暂无直达链接</span>
                  `}
                  ${item.contact ? `
                    <div class="text-[11px] text-slate-400 mt-1 truncate max-w-[140px]" title="${escapeHtml(item.contact)}">
                      ${escapeHtml(item.contact)}
                    </div>
                  ` : ''}
                </td>

                <!-- Delete Action -->
                <td class="py-3 px-4 align-top text-right whitespace-nowrap">
                  <button onclick="handleDeleteShop(${item.id})" class="text-slate-400 hover:text-red-500 p-1 transition-colors text-xs" title="移除此项">
                    🗑️
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    productsListView.appendChild(cardSection);
  });
}

// Scrape Handler (Supports multiple shops & interactive mode)
async function handleScrape({ interactive = false } = {}) {
  if (state.isScraping) return;

  state.isScraping = true;
  
  if (interactive) {
    btnInteractive.disabled = true;
    btnInteractive.classList.add('opacity-75', 'cursor-not-allowed');
    interactiveIcon.textContent = '⏳';
    interactiveText.textContent = '浏览器打开中...';
    showToast('🌐 桌面浏览器已启动！如遇滑块请直接在弹出窗口中完成滑动验证。');
  } else {
    btnScrape.disabled = true;
    btnScrape.classList.add('opacity-75', 'cursor-not-allowed');
    scrapeIcon.textContent = '⏳';
    scrapeText.textContent = '采集进行中...';
    showToast('🚀 正在批量抓取配置的小铺商品...');
  }

  const rawShops = cfgTargetShops?.value.trim() || 'https://wzyp.cn/shop/FT7';
  const cookie = cfgWafCookie?.value.trim() || '';

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: rawShops, cookie, interactive })
    });

    const result = await res.json();

    if (result.success) {
      showToast(`✅ ${result.message}`);
      if (result.cookie) {
        if (cfgWafCookie) cfgWafCookie.value = result.cookie;
        localStorage.setItem('scraper_waf_cookie', result.cookie);
      }
      loadStats();
      loadCategories();
      loadShopCodes();
      loadProducts();
      hideNotice();
    } else if (result.wafBlocked) {
      showNotice(
        'warning',
        '⚠️ 抓取过程中触发了阿里云ESA人机验证保护 (WAF)',
        `由于目标小铺启用了人机防火墙，建议直接点击下方按钮由系统为您唤起桌面浏览器进行交互式滑动：<br>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button onclick="handleInteractiveScrape()" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer">
            <span>👁️</span> 立即启动交互式验证抓取窗口
          </button>
        </div>
        <p class="text-[11px] text-slate-500 mt-2">点击后屏幕上会弹出 Chrome/Edge 浏览器窗口，您只需用鼠标拖动滑块，通过后程序将自动接管采集所有小铺商品并保存凭证！</p>`
      );
    } else {
      showNotice('danger', '❌ 抓取任务失败', result.message || '未知错误');
    }
  } catch (err) {
    showNotice('danger', '❌ 抓取请求发生异常', err.message);
  } finally {
    state.isScraping = false;
    btnScrape.disabled = false;
    btnScrape.classList.remove('opacity-75', 'cursor-not-allowed');
    scrapeIcon.textContent = '🚀';
    scrapeText.textContent = '批量快速抓取';

    btnInteractive.disabled = false;
    btnInteractive.classList.remove('opacity-75', 'cursor-not-allowed');
    interactiveIcon.textContent = '👁️';
    interactiveText.textContent = '交互验证抓取';
    loadStats();
  }
}

window.handleInteractiveScrape = function() {
  handleScrape({ interactive: true });
};

// Seed Sample Multi-Shop Data
async function handleSeed() {
  try {
    const res = await fetch('/api/seed', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast(`🎉 ${json.message}`);
      loadStats();
      loadCategories();
      loadShopCodes();
      loadProducts();
    } else {
      showToast('❌ 导入演示数据失败: ' + json.error);
    }
  } catch (err) {
    showToast('❌ 网络错误: ' + err.message);
  }
}

// Delete Product
window.handleDeleteShop = async function(id) {
  if (!confirm('确定要从列表中移除该商品记录吗？')) return;
  try {
    const res = await fetch(`/api/shops/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('🗑️ 商品已移除');
      loadStats();
      loadCategories();
      loadShopCodes();
      loadProducts();
    }
  } catch (err) {
    showToast('❌ 删除失败: ' + err.message);
  }
};

// UI Helper: Notice Banner
function showNotice(type, title, message) {
  noticeBanner.className = 'mb-6 p-4 rounded-xl border transition-all duration-300 ';
  const icon = document.getElementById('notice-icon');
  const titleEl = document.getElementById('notice-title');
  const descEl = document.getElementById('notice-desc');

  if (type === 'warning') {
    noticeBanner.classList.add('bg-amber-50', 'border-amber-200', 'text-amber-900');
    icon.textContent = '🛡️';
  } else if (type === 'danger') {
    noticeBanner.classList.add('bg-red-50', 'border-red-200', 'text-red-900');
    icon.textContent = '❌';
  } else {
    noticeBanner.classList.add('bg-indigo-50', 'border-indigo-200', 'text-indigo-900');
    icon.textContent = 'ℹ️';
  }

  titleEl.textContent = title;
  descEl.innerHTML = message;
  noticeBanner.classList.remove('hidden');
}

function hideNotice() {
  noticeBanner.classList.add('hidden');
}

// UI Helper: Toast
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// Modal Helpers
window.openModal = function(id) {
  document.getElementById(id).classList.remove('hidden');
};

window.closeModal = function(id) {
  document.getElementById(id).classList.add('hidden');
};

window.toggleCookieHelp = function() {
  const el = document.getElementById('cookie-help');
  el.classList.toggle('hidden');
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
