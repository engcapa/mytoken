// Frontend Application State
const state = {
  page: 1,
  limit: 12,
  search: '',
  category: '',
  totalPages: 1,
  isScraping: false
};

// DOM Elements
const shopsGrid = document.getElementById('shops-grid');
const emptyState = document.getElementById('empty-state');
const paginationBar = document.getElementById('pagination-bar');
const pageIndicator = document.getElementById('page-indicator');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const searchInput = document.getElementById('search-input');
const categoryPills = document.getElementById('category-pills');
const btnScrape = document.getElementById('btn-scrape');
const scrapeIcon = document.getElementById('scrape-icon');
const scrapeText = document.getElementById('scrape-text');
const btnInteractive = document.getElementById('btn-interactive');
const interactiveIcon = document.getElementById('interactive-icon');
const interactiveText = document.getElementById('interactive-text');
const btnSeed = document.getElementById('btn-seed');
const btnConfig = document.getElementById('btn-config');
const btnAddShop = document.getElementById('btn-add-shop');
const btnSubmitAdd = document.getElementById('btn-submit-add');
const btnSaveConfig = document.getElementById('btn-save-config');
const noticeBanner = document.getElementById('notice-banner');
const noticeClose = document.getElementById('notice-close');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadCategories();
  loadShops();
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
      loadShops();
    }, 300);
  });

  // Pagination
  btnPrevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      loadShops();
    }
  });

  btnNextPage.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      loadShops();
    }
  });

  // Scrape actions
  btnScrape.addEventListener('click', () => handleScrape({ interactive: false }));
  if (btnInteractive) {
    btnInteractive.addEventListener('click', () => handleScrape({ interactive: true }));
  }

  // Seed sample action
  btnSeed.addEventListener('click', handleSeed);

  // Config Modal
  btnConfig.addEventListener('click', () => openModal('modal-config'));
  btnSaveConfig.addEventListener('click', saveConfig);

  // Add Shop Modal
  btnAddShop.addEventListener('click', () => openModal('modal-add'));
  btnSubmitAdd.addEventListener('click', handleAddShop);

  // Notice close
  noticeClose.addEventListener('click', () => noticeBanner.classList.add('hidden'));
}

// Load Statistics
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (json.success) {
      document.getElementById('stat-total').textContent = json.data.totalShops || 0;
      document.getElementById('stat-categories').textContent = json.data.categoriesCount || 0;
      
      const last = json.data.lastScrape;
      if (last) {
        const timeStr = new Date(last.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        const badge = last.status === 'SUCCESS' ? '🟢 Success' : (last.status === 'WAF_BLOCKED' ? '🟠 WAF Challenge' : '🔴 Failed');
        document.getElementById('stat-last-time').textContent = `${timeStr} (${badge})`;
      } else {
        document.getElementById('stat-last-time').textContent = 'Not scraped yet';
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
        <button class="cat-pill ${state.category === '' ? 'active bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" data-category="">All</button>
      `;

      categories.forEach(item => {
        const activeClass = state.category === item.category ? 'active bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
        const btn = document.createElement('button');
        btn.className = `cat-pill ${activeClass} px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap`;
        btn.dataset.category = item.category;
        btn.innerHTML = `${item.category} <span class="opacity-60 text-[10px]">(${item.count})</span>`;
        categoryPills.appendChild(btn);
      });

      // Category click handler
      categoryPills.querySelectorAll('.cat-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          categoryPills.querySelectorAll('.cat-pill').forEach(b => {
            b.className = 'cat-pill bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap';
          });
          btn.className = 'cat-pill active bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap';
          state.category = btn.dataset.category;
          state.page = 1;
          loadShops();
        });
      });
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

// Load Shops List
async function loadShops() {
  try {
    shopsGrid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400">
        <span class="inline-block animate-spin text-2xl mb-2">⏳</span>
        <p class="text-xs">Loading shop records...</p>
      </div>
    `;

    const params = new URLSearchParams({
      page: state.page,
      limit: state.limit,
      search: state.search,
      category: state.category
    });

    const res = await fetch(`/api/shops?${params}`);
    const json = await res.json();

    if (!json.success || !json.data || json.data.items.length === 0) {
      shopsGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      paginationBar.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    renderShops(json.data.items);

    // Update pagination
    state.totalPages = json.data.pagination.totalPages;
    pageIndicator.textContent = `Page ${state.page} of ${state.totalPages} (${json.data.pagination.total} total)`;
    btnPrevPage.disabled = state.page <= 1;
    btnNextPage.disabled = state.page >= state.totalPages;
    paginationBar.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load shops:', err);
    shopsGrid.innerHTML = `<div class="col-span-full py-8 text-center text-red-500 text-xs">Failed to load data: ${err.message}</div>`;
  }
}

// Render Shop Cards
function renderShops(shops) {
  shopsGrid.innerHTML = '';

  shops.forEach(shop => {
    const card = document.createElement('div');
    card.className = 'shop-card-item bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col justify-between';

    const defaultImg = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=500&auto=format&fit=crop';
    const mainImg = (shop.images && shop.images.length > 0) ? shop.images[0] : defaultImg;

    card.innerHTML = `
      <div>
        <div class="h-44 w-full bg-slate-100 relative overflow-hidden">
          <img 
            src="${mainImg}" 
            alt="${escapeHtml(shop.title)}" 
            class="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
            onerror="this.src='${defaultImg}'"
          />
          <div class="absolute top-3 left-3">
            <span class="px-2.5 py-1 bg-white/90 backdrop-blur-xs text-indigo-700 text-[11px] font-semibold rounded-lg shadow-xs">
              ${escapeHtml(shop.category || 'General')}
            </span>
          </div>
          ${shop.price ? `
            <div class="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-xs text-white text-xs font-bold px-2 py-0.5 rounded-md">
              ${escapeHtml(shop.price)}
            </div>
          ` : ''}
        </div>

        <div class="p-4 sm:p-5">
          <h2 class="font-bold text-slate-900 text-base leading-snug line-clamp-2 hover:text-indigo-600 transition-colors">
            ${escapeHtml(shop.title)}
          </h2>
          <p class="text-xs text-slate-500 mt-2 line-clamp-3 leading-relaxed">
            ${escapeHtml(shop.description || 'No description available.')}
          </p>

          <div class="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
            ${shop.contact ? `
              <div class="flex items-center gap-1.5 truncate">
                <span class="text-slate-400">📞</span>
                <span class="truncate">${escapeHtml(shop.contact)}</span>
              </div>
            ` : ''}
            ${shop.address ? `
              <div class="flex items-center gap-1.5 truncate">
                <span class="text-slate-400">📍</span>
                <span class="truncate">${escapeHtml(shop.address)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
        <span class="text-[11px] text-slate-400">
          ${new Date(shop.updated_at || shop.created_at).toLocaleDateString()}
        </span>
        <div class="flex items-center gap-2">
          ${shop.source_url ? `
            <a href="${shop.source_url}" target="_blank" class="px-2.5 py-1 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-md font-medium transition-colors flex items-center gap-1">
              <span>Source</span> ↗
            </a>
          ` : ''}
          <button onclick="handleDeleteShop(${shop.id})" class="text-slate-400 hover:text-red-500 p-1 transition-colors" title="Delete">
            🗑️
          </button>
        </div>
      </div>
    `;

    shopsGrid.appendChild(card);
  });
}

// Scrape Handler
async function handleScrape({ interactive = false } = {}) {
  if (state.isScraping) return;

  state.isScraping = true;
  
  if (interactive) {
    if (btnInteractive) {
      btnInteractive.disabled = true;
      btnInteractive.classList.add('opacity-75', 'cursor-not-allowed');
      interactiveIcon.textContent = '⏳';
      interactiveText.textContent = 'Browser Open...';
    }
    showToast('🌐 Desktop browser opened! Please complete the slide verification in the pop-up window.');
  } else {
    btnScrape.disabled = true;
    btnScrape.classList.add('opacity-75', 'cursor-not-allowed');
    scrapeIcon.textContent = '⏳';
    scrapeText.textContent = 'Scraping...';
    showToast('🚀 Initiating scraping job...');
  }

  const targetUrl = document.getElementById('cfg-target-url')?.value.trim() || 'https://wzyp.cn';
  const cookie = document.getElementById('cfg-waf-cookie')?.value.trim() || '';

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, cookie, interactive })
    });

    const result = await res.json();

    if (result.success) {
      showToast(`✅ Scrape succeeded! Saved ${result.count} items.`);
      if (result.cookie) {
        const cookieInput = document.getElementById('cfg-waf-cookie');
        if (cookieInput) cookieInput.value = result.cookie;
        localStorage.setItem('scraper_waf_cookie', result.cookie);
      }
      loadStats();
      loadCategories();
      loadShops();
      hideNotice();
    } else if (result.wafBlocked) {
      showNotice(
        'warning',
        '⚠️ Target site triggered Alibaba Cloud ESA WAF Challenge',
        `The target site is protected by anti-bot verification. You can resolve this interactively without leaving the app:<br>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button onclick="handleInteractiveScrape()" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer">
            <span>👁️</span> Launch Interactive Verification Browser
          </button>
          <a href="${targetUrl}" target="_blank" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors">
            Open in External Browser
          </a>
        </div>
        <p class="text-[11px] text-slate-500 mt-2">Clicking "Launch Interactive Verification Browser" will pop up Chrome/Edge on your screen. Simply slide the puzzle, and the system will automatically grab the products and save your session!</p>`
      );
    } else {
      showNotice('danger', '❌ Scrape Job Failed', result.message || 'Unknown error');
    }
  } catch (err) {
    showNotice('danger', '❌ Scrape Request Error', err.message);
  } finally {
    state.isScraping = false;
    btnScrape.disabled = false;
    btnScrape.classList.remove('opacity-75', 'cursor-not-allowed');
    scrapeIcon.textContent = '🚀';
    scrapeText.textContent = 'Fast Scrape';

    if (btnInteractive) {
      btnInteractive.disabled = false;
      btnInteractive.classList.remove('opacity-75', 'cursor-not-allowed');
      interactiveIcon.textContent = '👁️';
      interactiveText.textContent = 'Interactive Scrape';
    }
    loadStats();
  }
}

window.handleInteractiveScrape = function() {
  handleScrape({ interactive: true });
};

// Seed Sample Data
async function handleSeed() {
  try {
    const res = await fetch('/api/seed', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast(`🎉 ${json.message}`);
      loadStats();
      loadCategories();
      loadShops();
    } else {
      showToast('❌ Seeding failed: ' + json.error);
    }
  } catch (err) {
    showToast('❌ Network error: ' + err.message);
  }
}

// Delete Shop
window.handleDeleteShop = async function(id) {
  if (!confirm('Are you sure you want to delete this shop record?')) return;
  try {
    const res = await fetch(`/api/shops/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('🗑️ Shop record deleted');
      loadStats();
      loadCategories();
      loadShops();
    }
  } catch (err) {
    showToast('❌ Delete failed: ' + err.message);
  }
};

// Add Shop Manually
async function handleAddShop() {
  const title = document.getElementById('add-title').value.trim();
  const category = document.getElementById('add-category').value.trim();
  const price = document.getElementById('add-price').value.trim();
  const contact = document.getElementById('add-contact').value.trim();
  const address = document.getElementById('add-address').value.trim();
  const description = document.getElementById('add-desc').value.trim();

  if (!title) {
    alert('Please enter a shop title');
    return;
  }

  try {
    const res = await fetch('/api/shops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category, price, contact, address, description })
    });
    const json = await res.json();
    if (json.success) {
      showToast('✅ Shop added successfully!');
      closeModal('modal-add');
      // Reset form
      document.getElementById('add-title').value = '';
      document.getElementById('add-category').value = '';
      document.getElementById('add-price').value = '';
      document.getElementById('add-contact').value = '';
      document.getElementById('add-address').value = '';
      document.getElementById('add-desc').value = '';
      loadStats();
      loadCategories();
      loadShops();
    } else {
      alert('Save failed: ' + json.error);
    }
  } catch (err) {
    alert('Request error: ' + err.message);
  }
}

// Save Config
function saveConfig() {
  const targetUrl = document.getElementById('cfg-target-url').value.trim();
  const cookie = document.getElementById('cfg-waf-cookie').value.trim();
  localStorage.setItem('scraper_target_url', targetUrl);
  localStorage.setItem('scraper_waf_cookie', cookie);
  showToast('💾 Settings saved! Applied to future scrape requests.');
  closeModal('modal-config');
}

// Restore saved config
const savedUrl = localStorage.getItem('scraper_target_url');
const savedCookie = localStorage.getItem('scraper_waf_cookie');
if (savedUrl) {
  const el = document.getElementById('cfg-target-url');
  if (el) el.value = savedUrl;
}
if (savedCookie) {
  const el = document.getElementById('cfg-waf-cookie');
  if (el) el.value = savedCookie;
}

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
