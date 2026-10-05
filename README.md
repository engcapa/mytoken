# Shop Scraper & Showcase Web Application

A lightweight, modern Node.js web application designed to scrape, store, and display store and shop information from target websites (primarily [wzyp.cn](https://wzyp.cn)).

---

## 🌟 Features

- ⚡ **Modern Stack**: Built with Node.js ES Modules, Express 5, Axios HTTP client, and Cheerio HTML parser.
- 💾 **Zero-Dependency Local Storage**: Powered by the native `node:sqlite` (`DatabaseSync`) module in Node.js 22+, providing fast, reliable SQLite storage without requiring C++ build tools or python-gyp.
- 🛡️ **WAF Challenge Detection**: Built-in detection for Alibaba Cloud ESA WAF slide challenges, with credential injection support (custom cookies and URLs).
- 🏪 **Multi-Shop Aggregation**: Support configuring and scraping multiple shops under wzyp.cn (e.g. `FT7`, `AI9`, etc.) in a single batch.
- 📊 **Categorized Table List View (No Cards)**: Items are grouped cleanly by category, filtered to in-stock goods only, and sorted by price from low to high.
- 🖥️ **Responsive Web Dashboard**: Clean, responsive frontend styled with Tailwind CSS:
  - Real-time statistics (in-stock items count, categories, shops covered)
  - Instant search filtering (title, specs, shop code)
  - Category pill filter tabs and shop dropdown filter
  - In-stock only toggle (enabled by default)
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
│   ├── config/              # Configuration module (dotenv)
│   │   └── index.js
│   ├── routes/              # Express REST API routes
│   │   └── api.js
│   ├── services/            # Core business services
│   │   ├── db.js            # SQLite database service (CRUD & stats)
│   │   └── scraper.js       # Web scraping service with WAF detection
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

## 🚀 Getting Started

### 1. Prerequisites

- Node.js >= 22.0.0 (v24 recommended)
- npm >= 10.0.0

### 2. Installation

```bash
npm install
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
- **Web UI**: Click the **"👁️ Interactive Scrape"** button in the dashboard (or click "Launch Interactive Verification Browser" on the warning banner). A desktop Chrome/Edge window will pop up automatically. Simply drag the slider captcha; the app will immediately extract the products, save your session cookies, and update the dashboard!
- **Terminal CLI**: Run `npm run scrape:interactive` to launch the interactive browser session.

### 🔧 Solution 2: Manual Cookie Injection
1. Open `https://wzyp.cn/shop/FT7` in your browser and complete the slide verification.
2. Press `F12` to open Developer Tools, go to the **Network** tab, refresh the page, and select any request.
3. Copy the value of the `Cookie` request header.
4. Click **"⚙️ Settings"** in the web dashboard, paste your Cookie, and save.

*Tip: You can click the **"📦 Seed Demo Data"** button on the web interface to preview sample stores immediately.*

*Tip: You can click the **"📦 Seed Demo Data"** button on the web interface to preview sample stores immediately.*

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/shops` | List shops (supports `search`, `category`, `page`, `limit`) |
| `GET` | `/api/shops/:id` | Get single shop details |
| `POST` | `/api/shops` | Add or update a shop manually |
| `DELETE` | `/api/shops/:id` | Delete a shop by ID |
| `GET` | `/api/categories` | Get all shop categories with item counts |
| `GET` | `/api/stats` | Get dashboard statistics |
| `POST` | `/api/scrape` | Trigger scraper task (body: `{ url?, cookie? }`) |
| `GET` | `/api/logs` | Retrieve recent scraping activity logs |
| `POST` | `/api/seed` | Populate database with realistic sample shops |

---

## 📜 License

[MIT](LICENSE)
