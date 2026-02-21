#!/usr/bin/env node
/**
 * Moomoo Guest Cookie 自动采集脚本
 *
 * 使用 Playwright 以 headless Chromium 自动采集游客 Cookie。
 * 每轮创建新的 incognito context，随机化指纹，导航后从 context.cookies() 提取。
 *
 * 用法:
 *   npx playwright install chromium   # 首次确保浏览器已安装
 *   node scripts/harvest-moomoo-cookies.js [--count 15]
 *
 * 输出: scripts/moomoo-cookies-output.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_COUNT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--count') || '15', 10);
const OUTPUT_PATH = path.join(__dirname, 'moomoo-cookies-output.json');
const TARGET_URL = 'https://www.moomoo.com/hans/currency/USDINDEX-FX';

// 随机化指纹库
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1680, height: 1050 },
];

const LOCALES = ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-GB'];
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Europe/London',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从 context.cookies() 构建完整 Cookie 字符串
 */
function buildCookieString(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function harvestOne(browser, round) {
  const ua = pick(USER_AGENTS);
  const viewport = pick(VIEWPORTS);
  const locale = pick(LOCALES);
  const timezone = pick(TIMEZONES);

  const context = await browser.newContext({
    userAgent: ua,
    viewport,
    locale,
    timezoneId: timezone,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  try {
    console.log(`[Round ${round + 1}] Navigating... (UA: ${ua.substring(0, 40)}..., viewport: ${viewport.width}x${viewport.height})`);

    // 用 commit 等待策略，不阻塞于后续资源加载
    await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 30000 });

    // 给页面 JS 执行时间设置 cookies
    console.log(`[Round ${round + 1}] Waiting for cookies to settle...`);
    await page.waitForTimeout(8000);

    // 从 browser context 获取 moomoo.com 域名下的所有 cookies
    const cookies = await context.cookies('https://www.moomoo.com');
    const csrfCookie = cookies.find((c) => c.name === 'csrfToken');

    if (!csrfCookie) {
      console.warn(`[Round ${round + 1}] No csrfToken cookie found (got ${cookies.length} cookies)`);
      return null;
    }

    const cookieString = buildCookieString(cookies);
    console.log(`[Round ${round + 1}] Captured csrfToken: ${csrfCookie.value} (${cookies.length} cookies total)`);
    return { csrfToken: csrfCookie.value, cookies: cookieString };
  } catch (error) {
    console.error(`[Round ${round + 1}] Error: ${error.message}`);
    return null;
  } finally {
    await context.close();
  }
}

async function main() {
  console.log(`\n=== Moomoo Guest Cookie Harvester ===`);
  console.log(`Target: ${TARGET_COUNT} unique cookie sets\n`);

  const browser = await chromium.launch({ headless: true });
  const results = new Map(); // csrfToken → { csrfToken, cookies }
  let round = 0;
  const maxRounds = TARGET_COUNT * 3; // 最多尝试 3 倍轮次

  while (results.size < TARGET_COUNT && round < maxRounds) {
    const result = await harvestOne(browser, round);

    if (result && !results.has(result.csrfToken)) {
      results.set(result.csrfToken, result);
      console.log(`  -> Unique #${results.size}/${TARGET_COUNT}\n`);
    } else if (result) {
      console.log(`  -> Duplicate csrfToken, skipping\n`);
    }

    round++;

    if (results.size < TARGET_COUNT && round < maxRounds) {
      // 随机延迟 3-5 秒避免触发检测
      const delay = 3000 + Math.random() * 2000;
      console.log(`  Waiting ${(delay / 1000).toFixed(1)}s before next round...`);
      await randomDelay(delay, delay);
    }
  }

  await browser.close();

  const output = Array.from(results.values());
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n=== Done ===`);
  console.log(`Harvested ${output.length}/${TARGET_COUNT} unique cookie sets`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  if (output.length < TARGET_COUNT) {
    console.warn(`WARNING: Only got ${output.length} cookies (target was ${TARGET_COUNT}). Run again to collect more.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
