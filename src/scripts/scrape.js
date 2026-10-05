import { scraperService } from '../services/scraper.js';
import config from '../config/index.js';

const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i');
const targetUrl = process.argv.find(arg => arg.startsWith('http')) || config.targetUrl;

console.log(`[Scraper CLI] Starting scrape job for target: ${targetUrl}`);
console.log(`[Scraper CLI] Mode: ${isInteractive ? 'Interactive (Desktop Browser)' : 'Fast (HTTP/Cheerio)'}`);
console.log(`[Scraper CLI] Time: ${new Date().toISOString()}`);

try {
  let result;
  if (isInteractive) {
    result = await scraperService.runInteractive({ url: targetUrl });
  } else {
    result = await scraperService.run({ url: targetUrl });
  }

  if (result.success) {
    console.log(`[Scraper CLI] Scraping succeeded! Saved items: ${result.count}`);
    if (result.cookie) {
      console.log(`[Scraper CLI] Captured valid session Cookie!`);
    }
  } else if (result.wafBlocked) {
    console.warn(`[Scraper CLI] Warning: Target site triggered Alibaba Cloud ESA WAF slide captcha!`);
    console.warn(`[Scraper CLI] Run with interactive mode to solve the slider:`);
    console.warn(`              npm run scrape:interactive`);
    console.warn(`              or: node src/scripts/scrape.js --interactive`);
  } else {
    console.error(`[Scraper CLI] Scraping failed: ${result.message}`);
  }
} catch (err) {
  console.error(`[Scraper CLI] Execution error:`, err);
  process.exit(1);
}
