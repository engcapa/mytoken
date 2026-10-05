import createApp from './app.js';
import config from './config/index.js';
import { initDatabase } from './services/db.js';

// Initialize database
initDatabase();

const app = createApp();

app.listen(config.port, () => {
  console.log(`===============================================`);
  console.log(` Web App Server running at: http://localhost:${config.port}`);
  console.log(` Database Path: ${config.databasePath}`);
  console.log(` Scraper Target: ${config.targetUrl}`);
  console.log(`===============================================`);
});
