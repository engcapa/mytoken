import { scraperService } from '../services/scraper.js';
import config from '../config/index.js';

console.log(`[Scraper CLI] Starting scrape job for target: ${config.targetUrl}`);
console.log(`[Scraper CLI] Time: ${new Date().toISOString()}`);

try {
  const result = await scraperService.run();
  if (result.success) {
    console.log(`[Scraper CLI] Scraping succeeded! Saved items: ${result.count}`);
  } else if (result.wafBlocked) {
    console.warn(`[Scraper CLI] Warning: Target site triggered Alibaba Cloud ESA WAF slide captcha protection!`);
    console.warn(`[Scraper CLI] Tip: Please visit ${config.targetUrl} in your browser to solve the captcha, then copy the session Cookie to WAF_COOKIE in your .env file.`);
  } else {
    console.error(`[Scraper CLI] Scraping failed: ${result.message}`);
  }
} catch (err) {
  console.error(`[Scraper CLI] Execution error:`, err);
  process.exit(1);
}
