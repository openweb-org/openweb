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

  // Search for products
  await page.goto('https://www.bestbuy.com/site/searchpage.jsp?st=airpods', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(3000)

  // Search for TVs
  await page.goto('https://www.bestbuy.com/site/searchpage.jsp?st=4k+tv', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(3000)

  // Price blocks API directly (multiple SKUs for param variation)
  await page.goto('https://www.bestbuy.com/api/3.0/priceBlocks?skus=6576014', {
    waitUntil: 'domcontentloaded', timeout: 10000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.goto('https://www.bestbuy.com/api/3.0/priceBlocks?skus=6605198', {
    waitUntil: 'domcontentloaded', timeout: 10000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.goto('https://www.bestbuy.com/api/3.0/priceBlocks?skus=6576014,6605198', {
    waitUntil: 'domcontentloaded', timeout: 10000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await context.close()
  await browser.close()

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright',
    source: 'scripts/record_bestbuy.ts',
    flow_count: 5,
    har_path: harPath,
  }
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()
