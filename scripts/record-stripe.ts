/**
 * Record Stripe dashboard traffic via managed Chrome CDP.
 * Used by: openweb compile https://dashboard.stripe.com --script scripts/record-stripe.ts
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

      // Only capture API calls to stripe.com
      if (!url.includes('stripe.com') && !url.includes('stripe.network')) return
      // Skip static assets
      if (url.match(/\.(js|css|png|jpg|svg|woff|ico|gif)(\?|$)/)) return

      const requestHeaders = await request.headersArray()
      const responseHeaders = await response.headersArray()
      const status = response.status()
      const contentType = (await response.headerValue('content-type')) ?? ''

      let bodyText: string | undefined
      try {
        if (contentType.includes('json') || contentType.includes('text')) {
          bodyText = await response.text()
        }
      } catch { /* body not available for some responses */ }

      let postData: { mimeType: string; text: string } | undefined
      if (request.postData()) {
        postData = {
          mimeType: request.headerValue('content-type') ?? 'application/x-www-form-urlencoded',
          text: request.postData()!,
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
    } catch { /* ignore errors in response handler */ }
  })

  const pages = [
    'https://dashboard.stripe.com/test/dashboard',
    'https://dashboard.stripe.com/test/customers',
    'https://dashboard.stripe.com/test/payments',
    'https://dashboard.stripe.com/test/products',
    'https://dashboard.stripe.com/test/invoices',
    'https://dashboard.stripe.com/test/subscriptions',
    'https://dashboard.stripe.com/test/balance/overview',
    'https://dashboard.stripe.com/test/events',
  ]

  for (const url of pages) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2000)
  }

  await page.close()

  // Write HAR
  const har = { log: { version: '1.2', entries } }
  await writeFile(path.join(outDir, 'traffic.har'), JSON.stringify(har, null, 2))

  // Write metadata
  await writeFile(path.join(outDir, 'metadata.json'), JSON.stringify({
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright_cdp',
    source: 'scripts/record-stripe.ts',
    flow_count: pages.length,
  }, null, 2))

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
  await browser.close()
}

await main()
