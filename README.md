# Shop Scraper & Showcase Web Application

A lightweight, modern Node.js web application designed to scrape, store, and display store and shop information from target websites (primarily [wzyp.cn](https://wzyp.cn)).

---

## 🌟 Features

- ⚡ **Modern Stack**: Built with Node.js ES Modules, Express 5, Axios HTTP client, and Cheerio HTML parser.
- 💾 **Zero-Dependency Local Storage**: Powered by the native `node:sqlite` (`DatabaseSync`) module in Node.js 22+, providing fast, reliable SQLite storage without requiring C++ build tools or python-gyp.
- 🛡️ **WAF Challenge Detection**: Built-in detection for Alibaba Cloud ESA WAF slide challenges, with credential injection support (custom cookies and URLs).
- 🏪 **Multi-Shop Aggregation**: Support configuring and scraping multiple shops under wzyp.cn (e.g. `FT7`, `G062JE24`, etc.) in a single batch.
- 🔗 **Direct Item Detail Links**: Scrapes exact product detail links (`https://wzyp.cn/item/{goods_key}`), allowing users to jump directly to specific items rather than shop homepages.
- 🤖 **TypeSafe Jev AI Model Integration**: Built-in integration with TypeSafe's "System One" decision model (`jev-latest`), enabling sub-second intelligent DOM container detection and browser action decisions (inspired by `browser-use/jev-ultrafast`).
- 🌐 **Comprehensive Proxy Support**: Configurable HTTP/HTTPS proxy support for both Jev AI requests and scraping requests.
- 📊 **Categorized Table List View (No Cards)**: Items are grouped cleanly by category, filtered to in-stock goods only, and sorted by price from low to high.
- 🖥️ **Responsive Web Dashboard**: Clean, responsive frontend styled with Tailwind CSS:
  - Real-time statistics (in-stock items count, categories, shops covered)
  - Instant search filtering (title, specs, shop code)
  - Category pill filter tabs and shop dropdown filter
  - In-stock only toggle (enabled by default)
  - Jev AI & Proxy settings panel with live connectivity tester
  - One-click batch scraping and demo data seeding
- 🛠️ **CLI & REST API**: Run scraping tasks via terminal or integrate with external services through REST endpoints.

---

## 📁 Project Structure

```text
mytoken/
├── data/                    # Local SQLite database directory
│   ├── .gitkeep
│   └── shops.sqlite         # SQLite database file (auto-generated)
├── src/
│   ├── config/              # Configuration module (dotenv & proxy)
│   │   └── index.js
│   ├── routes/              # Express REST API routes
│   │   └── api.js
│   ├── services/            # Core business services
│   │   ├── db.js            # SQLite database service (CRUD & stats)
│   │   ├── jev.js           # TypeSafe Jev System One model & proxy service
│   │   └── scraper.js       # Web scraping service with WAF & Jev integration
│   ├── scripts/             # Standalone CLI scripts
│   │   └── scrape.js        # Command-line scraper runner
│   ├── public/              # Static frontend assets
│   │   ├── index.html       # Web dashboard UI
│   │   ├── css/style.css    # Custom styles
│   │   └── js/app.js        # Frontend logic and state management
│   ├── app.js               # Express application setup
│   └── server.js            # Server entry point
├── .env.example             # Environment configuration template
├── .env                     # Local environment file
├── .gitignore               # Git ignore rules
├── package.json             # Dependencies and npm scripts
└── README.md                # Project documentation
```

---

## 🤖 TypeSafe Jev Model Service & Browser-Use Integration

### 1. What is Jev?
**Jev** is a "System One" decision model developed by **TypeSafe AI** (`https://typesafe.ai`). Unlike traditional generative LLMs designed for open-ended text chat:
- **Non-Generative & Typesafe**: Jev takes structured/unstructured state and evaluates typed questions (`choice`, `noul` (yes/no probability), `score`).
- **Ultra-Fast & Cost-Effective**: Decisions typically complete in **sub-500ms**, at a fraction of the cost (~400x cheaper than full LLM calls).
- **Official API Endpoint**: `POST https://api.typesafe.ai/v1/systemone`

### 2. How `browser-use/jev-ultrafast` Uses Jev
The open-source [`browser-use/jev-ultrafast`](https://github.com/browser-use/jev-ultrafast) project demonstrates using Jev for high-speed browser automation:
1. **Indexed Action Space**: The browser agent extracts candidate interactive elements from the DOM and numbers them:
   ```text
   [1] Tab "G Plus" (category switch)
   [2] Card ".goods_item" (item: Codex AI Plus)
   [3] Button "下一页" (pagination)
   ```
2. **System One Decision**: The state is sent to Jev with a `choice` question:
   `"Which action should the browser take next to discover products?"`
3. Jev returns the selected option and target ID in a single round-trip without needing token-by-token generation.

### 3. Jev in This Project: Intelligent Scraping Assistance
Our application integrates Jev via `src/services/jev.js`:
- **DOM Container Judgment**: When scraping shops with custom or unfamiliar CSS layouts, Jev evaluates candidate containers and chooses the genuine product listings container.
- **WAF / CAPTCHA Detection**: Uses Jev's `noul` primitive to verify whether an ambiguous page barrier is a CAPTCHA slider challenge.
- **Proxy Compatibility**: Full HTTP/HTTPS forward proxy support for connecting to `api.typesafe.ai` from regions requiring a proxy.

#### Request & Response Example
**Request (`POST https://api.typesafe.ai/v1/systemone`):**
```json
{
  "model": "jev-latest",
  "state": "Candidate 1: selector='.goods_item' count=11 sample='GLM-5.2 ¥570'\nCandidate 2: selector='.nav_tabs' count=3 sample='首页 关于 联系'",
  "questions": {
    "target_container": {
      "type": "choice",
      "instructions": "Which candidate represents the genuine product listings container?",
      "criteria": {
        "candidate_1": "Elements matching .goods_item",
        "candidate_2": "Elements matching .nav_tabs"
      }
    },
    "is_shop_page": {
      "type": "noul",
      "instructions": "Does this page show real e-commerce products?"
    }
  }
}
```

**Response:**
```json
{
  "model": "jev-latest",
  "usage": { "input_tokens": 85, "output_tokens": 0 },
  "answers": {
    "target_container": {
      "type": "choice",
      "choice": "candidate_1",
      "confidence": 0.98,
      "probabilities": { "candidate_1": 0.98, "candidate_2": 0.02 }
    },
    "is_shop_page": {
      "type": "noul",
      "noul": 0.96
    }
  }
}
```

### 4. Cross-Shop Category Harmonization via Jev
Different shops on `wzyp.cn` use inconsistent names, abbreviations, or typos for identical products:
- Shop `FT7`: `"G Plus"`, `"G Plus带质保"`, `"G K12 Team"`
- Shop `G062JE24`: `"OpenAI Plus 网页成品"`
- Shop `FT7`: `"谷歌 | Gemini"`
- Shop `G062JE24`: `"Gemini Pro 成品账户"`

Without normalization, users cannot compare prices across shops. Using Jev's `choice` decision API, our system analyzes both the raw category name and representative product titles:
1. **Semantic Clustering**: Maps disparate merchant categories into standardized canonical categories (e.g. `ChatGPT / OpenAI`, `Anthropic Claude`, `Google Gemini`, `API 中转与算力`, `手机接码与验证`, `邮箱与账号体系`).
2. **Persistent Caching**: Category decisions are saved to the `category_mappings` SQLite table, avoiding redundant external API calls during ongoing scrapes.
3. **Cross-Shop Price Comparison**: In the dashboard, products from different shops are grouped under unified canonical categories, ordered strictly from lowest price to highest price with individual "直达商品 ↗" links.
4. **On-Demand & Automatic Harmonization**: Runs automatically during scraping, or triggered on-demand via the dashboard's **"🤖 Jev 智能统一分类"** button or REST endpoint `POST /api/jev/harmonize`.

---

## 🚀 Getting Started

### 1. Prerequisites

- Node.js >= 22.0.0 (v24 recommended)
- npm >= 10.0.0

### 2. Configuration (`.env`)

Copy `.env.example` to `.env` and configure your settings:

```ini
# Server Configuration
PORT=3000

# Database Configuration
DATABASE_PATH=./data/shops.sqlite

# Target Shop
TARGET_URL=https://wzyp.cn

# TypeSafe Jev Model Service
JEV_ENABLED=true
JEV_API_KEY=your_typesafe_api_key_here
JEV_BASE_URL=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
JEV_USE_PROXY=true

# Proxy Settings (e.g. Clash, V2Ray, or corporate proxy)
GLOBAL_PROXY_ENABLED=false
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

### 3. Start the Web Server

```bash
# Start in production mode
npm start

# Start in development mode (with file watch and hot restart)
npm run dev
```

Open your browser and navigate to: **http://localhost:3000**

### 4. Run Scraper via Command Line

```bash
# Standard fast scraping
npm run scrape

# Interactive desktop browser mode (pops up window to solve captcha)
npm run scrape:interactive
```

---

## 🛡️ Target Site Anti-Scraping (WAF) & Interactive Bypass

The target domain `https://wzyp.cn` is protected by **Alibaba Cloud ESA Web Application Firewall (WAF)** with slide captcha verification. Unauthenticated automated requests will receive a captcha challenge page.

### 🌟 Solution 1: Interactive Browser Mode (Recommended)
- **Web UI**: Click the **"👁️ 交互验证抓取"** button in the dashboard. A desktop Chrome window will pop up automatically. Simply drag the slider captcha; the app will immediately extract the products, save your session cookies, and update the dashboard!
- **Terminal CLI**: Run `npm run scrape:interactive` to launch the interactive browser session.

### 🔧 Solution 2: Manual Cookie Injection
1. Open `https://wzyp.cn/shop/FT7` in your browser and complete the slide verification.
2. Press `F12` to open Developer Tools, go to the **Network** tab, refresh the page, and select any request.
3. Copy the value of the `Cookie` request header.
4. Click **"⚙️ 小铺管理设置"** in the web dashboard, paste your Cookie, and save.

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/shops` | List shops/products (supports `search`, `category`, `shopCode`, `inStockOnly`, `page`, `limit`) |
| `GET` | `/api/shops/:id` | Get single product details |
| `POST` | `/api/shops` | Add or update a product manually |
| `DELETE` | `/api/shops/:id` | Delete a product by ID |
| `GET` | `/api/categories` | Get all product categories with item counts |
| `GET` | `/api/shop-codes` | Get distinct shop codes present in database |
| `GET` | `/api/stats` | Get dashboard statistics |
| `POST` | `/api/scrape` | Trigger scraper task (body: `{ url?, urls?, cookie?, interactive? }`) |
| `GET` | `/api/logs` | Retrieve recent scraping activity logs |
| `POST` | `/api/seed` | Populate database with realistic sample shops |
| `GET` | `/api/jev/config` | Retrieve current TypeSafe Jev & proxy status |
| `POST` | `/api/jev/config` | Update TypeSafe Jev API key, model, and proxy runtime settings |
| `POST` | `/api/jev/test` | Test connectivity to TypeSafe Jev System One endpoint |

---

## 📜 License

[MIT](LICENSE)
