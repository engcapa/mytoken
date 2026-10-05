import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const statusFilePath = path.resolve(__dirname, '../../data/ip_monitor.json');

// Ensure data folder exists
const dataDir = path.dirname(statusFilePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const targetUrl = 'https://wzyp.cn/shop/FT7';
const checkIntervalMs = 5 * 60 * 1000; // Check every 5 minutes (300 seconds)

let startTime = Date.now();
let checkCount = 0;

if (fs.existsSync(statusFilePath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
    if (prev.startTimestamp && typeof prev.startTimestamp === 'number') {
      startTime = prev.startTimestamp;
    } else if (prev.startedAt) {
      const parsed = Date.parse(prev.startedAt);
      if (!isNaN(parsed)) {
        startTime = parsed;
      }
    }
    if (typeof prev.checkCount === 'number') {
      checkCount = prev.checkCount;
    }
  } catch {
    // Ignore JSON read error
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes === 0) return `${seconds}秒`;
  return `${minutes}分${seconds}秒`;
}

function probeDirect(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      timeout: 8000
    }, (res) => {
      resolve({
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        proxyStatus: res.headers['proxy-status'] || '',
        server: res.headers['server'] || '',
        via: res.headers['via'] || ''
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 0,
        statusMessage: err.message,
        proxyStatus: '',
        error: err.code || err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: 0,
        statusMessage: 'TIMEOUT',
        proxyStatus: '',
        error: 'TIMEOUT'
      });
    });
  });
}

function saveStatus(data) {
  try {
    fs.writeFileSync(statusFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save status file:', err.message);
  }
}

async function runCheck() {
  checkCount++;
  const elapsedMs = Date.now() - startTime;
  const elapsedStr = formatDuration(elapsedMs);
  const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });

  const result = await probeDirect(targetUrl);
  const isBlocked = result.statusCode === 520 || result.statusCode === 502 || (result.proxyStatus && result.proxyStatus.includes('os_error'));

  const statusData = {
    targetUrl,
    status: isBlocked ? 'BLOCKED' : 'UNBANNED',
    statusCode: result.statusCode,
    statusMessage: result.statusMessage,
    proxyStatus: result.proxyStatus,
    checkCount,
    startTimestamp: startTime,
    startedAt: new Date(startTime).toLocaleString('zh-CN', { hour12: false }),
    lastCheckAt: nowStr,
    elapsedMs,
    elapsedText: elapsedStr,
    unbannedAt: isBlocked ? null : nowStr,
    totalMinutesToUnban: isBlocked ? null : Math.round(elapsedMs / 60000)
  };

  saveStatus(statusData);

  if (isBlocked) {
    console.log(`[${nowStr}] [第 ${checkCount} 次探测] 状态: HTTP ${result.statusCode} (${result.statusMessage}) | 仍处于阻断期 | 已持续: ${elapsedStr}`);
  } else {
    console.log(`\n================================================================`);
    console.log(`🎉🎉🎉 [${nowStr}] 目标站点已成功解封！`);
    console.log(`📊 探测次数: 第 ${checkCount} 次`);
    console.log(`⏱️ 解封累计耗时: ${elapsedStr} (约 ${Math.round(elapsedMs / 60000)} 分钟)`);
    console.log(`🌐 最新响应状态: HTTP ${result.statusCode} ${result.statusMessage}`);
    console.log(`================================================================\n`);
    process.exit(0);
  }
}

console.log(`================================================================`);
console.log(`🔍 启动本机 IP 解封自动监控定时任务`);
console.log(`🎯 目标监测链接: ${targetUrl} (直连无代理)`);
console.log(`⏱️ 探测频率: 每 5 分钟 (300 秒) 自动探针一次`);
console.log(`📂 状态文件同步: ${statusFilePath}`);
console.log(`================================================================`);

// Immediate first check
await runCheck();

// Recurring interval
setInterval(runCheck, checkIntervalMs);
