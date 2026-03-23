import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

function parseArg(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.findIndex((item) => item === flag)
  return index >= 0 ? args[index + 1] : undefined
}

async function main(): Promise<void> {
  const outDir = path.resolve(parseArg('--out') ?? 'recording')
  await mkdir(outDir, { recursive: true })

  const harPath = path.join(outDir, 'traffic.har')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    recordHar: { path: harPath, mode: 'full', content: 'embed' },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  // Autocomplete API — real JSON endpoints (multiple queries to get varied samples)
  await page.goto('https://www.yelp.com/search_suggest/v2/prefetch?prefix=piz&loc=San+Francisco', {
    waitUntil: 'networkidle', timeout: 15000,
  })
  await page.waitForTimeout(1000)

  await page.goto('https://www.yelp.com/search_suggest/v2/prefetch?prefix=coffee&loc=New+York', {
    waitUntil: 'networkidle', timeout: 15000,
  })
  await page.waitForTimeout(1000)

  await page.goto('https://www.yelp.com/search_suggest/v2/prefetch?prefix=sushi&loc=Los+Angeles', {
    waitUntil: 'networkidle', timeout: 15000,
  })
  await page.waitForTimeout(1000)

  // Search pages (SSR with embedded data)
  await page.goto('https://www.yelp.com/search?find_desc=pizza&find_loc=San+Francisco%2C+CA', {
    waitUntil: 'networkidle', timeout: 30000,
  })
  await page.waitForTimeout(2000)

  await page.goto('https://www.yelp.com/search?find_desc=coffee&find_loc=New+York%2C+NY', {
    waitUntil: 'networkidle', timeout: 30000,
  })
  await page.waitForTimeout(2000)

  await page.goto('https://www.yelp.com/search?find_desc=restaurants&find_loc=Los+Angeles%2C+CA', {
    waitUntil: 'networkidle', timeout: 30000,
  })
  await page.waitForTimeout(2000)

  // Business detail pages
  await page.goto('https://www.yelp.com/biz/tonys-pizza-napoletana-san-francisco', {
    waitUntil: 'networkidle', timeout: 30000,
  })
  await page.waitForTimeout(2000)

  await page.goto('https://www.yelp.com/biz/tartine-bakery-san-francisco', {
    waitUntil: 'networkidle', timeout: 30000,
  })
  await page.waitForTimeout(2000)

  await context.close()
  await browser.close()

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright',
    source: 'scripts/record_yelp.ts',
    flow_count: 8,
    har_path: harPath,
  }
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()
