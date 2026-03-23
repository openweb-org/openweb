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

  // Docker Hub search API (public, no auth)
  await page.goto('https://hub.docker.com/api/search/v3/catalog/search?query=nginx&from=0&size=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.goto('https://hub.docker.com/api/search/v3/catalog/search?query=node&from=0&size=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.goto('https://hub.docker.com/api/search/v3/catalog/search?query=python&from=0&size=5&type=image', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Docker Hub v2 namespace API (may be public for library images)
  await page.goto('https://hub.docker.com/v2/repositories/library/nginx/', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.goto('https://hub.docker.com/v2/repositories/library/node/', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.goto('https://hub.docker.com/v2/repositories/library/nginx/tags/?page_size=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Browse search page (triggers internal API calls)
  await page.goto('https://hub.docker.com/search?q=redis', {
    waitUntil: 'domcontentloaded', timeout: 20000,
  }).catch(() => {})
  await page.waitForTimeout(4000)

  await context.close()
  await browser.close()

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright',
    source: 'scripts/record_docker_hub.ts',
    flow_count: 7,
    har_path: harPath,
  }
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()
