/**
 * Record Notion API traffic via managed Chrome (CDP).
 * User must be logged in to Notion in the managed browser.
 */
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, type Page, type Response } from 'playwright'

function parseArg(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.findIndex((item) => item === flag)
  return index >= 0 ? args[index + 1] : undefined
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
  const outDir = path.resolve(parseArg('--out') ?? 'recording')
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const context = browser.contexts()[0]
  const page = await context.newPage()

  const entries: HarEntry[] = []

  page.on('response', async (response: Response) => {
    try {
      const request = response.request()
      const url = request.url()

      // Only capture notion.so API calls
      if (!url.includes('notion.so/api') && !url.includes('notion.so/f/')) return
      // Skip static assets
      if (url.match(/\.(js|css|png|jpg|svg|woff|woff2|ico)(\?|$)/)) return

      const requestHeaders = await request.headersArray()
      const responseHeaders = await response.headersArray()
      const contentType = (await response.headerValue('content-type')) ?? ''

      let bodyText: string | undefined
      try {
        if (contentType.includes('json')) {
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
          status: response.status(),
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

  // Navigate through Notion pages to capture API traffic
  // Homepage / recent pages
  await page.goto('https://www.notion.so/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(5000)

  // Search
  await page.evaluate(async () => {
    // Trigger search via internal API
    const res = await fetch('https://www.notion.so/api/v3/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'BlocksInSpace',
        query: 'test',
        spaceId: '',
        limit: 10,
        filters: { isDeletedOnly: false, navigableBlockContentOnly: true },
      }),
    })
    return res.status
  }).catch(() => {})
  await page.waitForTimeout(3000)

  // Get space info
  await page.evaluate(async () => {
    const res = await fetch('https://www.notion.so/api/v3/getSpaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    return res.status
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Get user info
  await page.evaluate(async () => {
    const res = await fetch('https://www.notion.so/api/v3/getPublicPageData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'block-space' }),
    })
    return res.status
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await page.close()

  const har = { log: { version: '1.2', entries } }
  await writeFile(path.join(outDir, 'traffic.har'), JSON.stringify(har, null, 2))

  await writeFile(path.join(outDir, 'metadata.json'), JSON.stringify({
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright_cdp',
    source: 'scripts/record_notion.ts',
    flow_count: entries.length,
    entry_count: entries.length,
  }, null, 2))

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir, entries: entries.length })}\n`)
  browser.close()
}

await main()
