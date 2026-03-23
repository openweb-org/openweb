/**
 * Generic CDP recording script for openweb compile.
 * Connects to managed Chrome, navigates through site pages, captures HAR.
 *
 * Usage: pnpm exec tsx scripts/record-cdp.ts --out <dir>
 *
 * The RECORD_SITE and RECORD_PAGES env vars control which site to record.
 * Set RECORD_SITE=stripe and RECORD_PAGES as JSON array of URLs.
 */
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

function parseArg(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.findIndex((item) => item === flag)
  if (index < 0) return undefined
  return args[index + 1]
}

interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    headers: Array<{ name: string; value: string }>
    postData?: { mimeType: string; text: string }
  }
  response: {
    status: number
    statusText: string
    headers: Array<{ name: string; value: string }>
    content: { size: number; mimeType: string; text?: string }
  }
}

async function main(): Promise<void> {
  const outDir = path.resolve(parseArg('--out') ?? path.join(process.cwd(), 'recording'))
  await mkdir(outDir, { recursive: true })

  const siteName = process.env.RECORD_SITE ?? 'unknown'
  const pagesJson = process.env.RECORD_PAGES ?? '[]'
  const pages: string[] = JSON.parse(pagesJson)
  const domainFilter = process.env.RECORD_DOMAIN ?? ''

  if (pages.length === 0) {
    throw new Error('RECORD_PAGES env var must be set to a JSON array of URLs')
  }

  const cdpEndpoint = 'http://localhost:9222'
  const browser = await chromium.connectOverCDP(cdpEndpoint)
  const context = browser.contexts()[0]
  const page = await context.newPage()

  const entries: HarEntry[] = []

  // Intercept network responses
  page.on('response', async (response) => {
    try {
      const request = response.request()
      const url = request.url()

      // Only capture API calls matching domain filter
      if (domainFilter && !url.includes(domainFilter)) return
      // Skip static assets
      if (url.match(/\.(js|css|png|jpg|svg|woff|woff2|ico|gif|ttf|eot|map)(\?|$)/)) return
      // Skip tracking/analytics
      if (url.match(/(google-analytics|googletagmanager|facebook\.net|segment\.io|amplitude\.com|mixpanel\.com)/)) return

      const requestHeaders = await request.headersArray()
      const responseHeaders = await response.headersArray()
      const status = response.status()
      const contentType = (await response.headerValue('content-type')) ?? ''

      let bodyText: string | undefined
      try {
        if (contentType.includes('json') || contentType.includes('text/html') || contentType.includes('text/plain')) {
          bodyText = await response.text()
        }
      } catch { /* body not available */ }

      let postData: { mimeType: string; text: string } | undefined
      const pd = request.postData()
      if (pd) {
        postData = {
          mimeType: (await request.headerValue('content-type')) ?? 'application/json',
          text: pd,
        }
      }

      entries.push({
        startedDateTime: new Date().toISOString(),
        time: 0,
        request: {
          method: request.method(),
          url,
          headers: requestHeaders,
          ...(postData ? { postData } : {}),
        },
        response: {
          status,
          statusText: response.statusText(),
          headers: responseHeaders,
          content: {
            size: bodyText?.length ?? 0,
            mimeType: contentType,
            text: bodyText,
          },
        },
      })
    } catch { /* ignore */ }
  })

  for (const url of pages) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    }
    await page.waitForTimeout(2000)
  }

  await page.close()

  const har = { log: { version: '1.2', entries } }
  await writeFile(path.join(outDir, 'traffic.har'), JSON.stringify(har, null, 2))

  await writeFile(path.join(outDir, 'metadata.json'), JSON.stringify({
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright_cdp',
    source: `scripts/record-cdp.ts (${siteName})`,
    flow_count: pages.length,
    entry_count: entries.length,
  }, null, 2))

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
  await browser.close()
}

await main()
