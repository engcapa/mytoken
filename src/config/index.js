import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(rootDir, process.env.DATABASE_PATH)
    : path.resolve(rootDir, 'data/shops.sqlite'),
  targetUrl: process.env.TARGET_URL || 'https://wzyp.cn',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  wafCookie: process.env.WAF_COOKIE || '',
  // TypeSafe Jev Model Configuration
  jev: {
    enabled: process.env.JEV_ENABLED === 'true',
    apiKey: process.env.JEV_API_KEY || '',
    baseUrl: process.env.JEV_BASE_URL || 'https://api.typesafe.ai/v1/systemone',
    model: process.env.JEV_MODEL || 'jev-latest',
    useProxy: process.env.JEV_USE_PROXY === 'true'
  },
  // Proxy Configuration
  proxy: {
    enabled: process.env.GLOBAL_PROXY_ENABLED === 'true',
    httpProxy: process.env.HTTP_PROXY || process.env.http_proxy || '',
    httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || '',
    allProxy: process.env.ALL_PROXY || process.env.all_proxy || ''
  },
  rootDir
};

export default config;
