// CDP navigation helper for capture sessions
// Usage: pnpm exec tsx scripts/navigate.ts <url1> <url2> ...
// Navigates to each URL with delays for lazy loading.

import { chromium } from 'playwright';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Usage: pnpm exec tsx scripts/navigate.ts <url1> <url2> ...');
  process.exit(1);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  for (const url of urls) {
    console.log(`→ ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(2000);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await delay(2000);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await delay(1500);
      console.log(`  ✓ ${page.url()}`);
    } catch (e: any) {
      console.error(`  ✗ ${e.message}`);
    }
  }

  await page.close();
  console.log('Done — tab closed.');
  browser.close();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
