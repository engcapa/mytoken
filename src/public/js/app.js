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

  // Seed sample action
  btnSeed.addEventListener('click', handleSeed);

  // Config Modal
  btnConfig.addEventListener('click', () => openModal('modal-config'));
  btnSaveConfig.addEventListener('click', saveConfig);

  // Notice close
  noticeClose.addEventListener('click', () => noticeBanner.classList.add('hidden'));
}

// Restore saved settings
function restoreConfig() {
  const defaultShops = 'https://wzyp.cn/shop/FT7\nhttps://wzyp.cn/shop/G062JE24';
  const savedShops = localStorage.getItem('scraper_target_shops') || defaultShops;
  const savedCookie = localStorage.getItem('scraper_waf_cookie') || '';
  if (cfgTargetShops) cfgTargetShops.value = savedShops;
  if (cfgWafCookie) cfgWafCookie.value = savedCookie;
}

// Save settings
function saveConfig() {
  const shops = cfgTargetShops.value.trim();
  const cookie = cfgWafCookie.value.trim();
  localStorage.setItem('scraper_target_shops', shops);
  localStorage.setItem('scraper_waf_cookie', cookie);
  showToast('💾 小铺配置已保存！抓取时将依次扫描处理。');
  closeModal('modal-config');
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

  // Group items by category
  const groups = {};
  items.forEach(item => {
    const cat = item.category || '未分类专区';
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
            ${groupItems.length} 件在售
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
