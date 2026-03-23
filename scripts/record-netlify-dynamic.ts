/**
 * Record Netlify traffic via managed Chrome CDP.
 * Discovers team slug dynamically and browses key pages.
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

  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const context = browser.contexts()[0]
  const page = await context.newPage()

  const entries: HarEntry[] = []

  page.on('response', async (response) => {
    try {
      const request = response.request()
      const url = request.url()
      if (!url.includes('netlify.com') && !url.includes('netlify.app')) return
      if (url.match(/\.(js|css|png|jpg|svg|woff|woff2|ico|gif|ttf|eot|map)(\?|$)/)) return
      if (url.match(/(google-analytics|googletagmanager|segment\.io|amplitude)/)) return

      const requestHeaders = await request.headersArray()
      const responseHeaders = await response.headersArray()
      const status = response.status()
      const contentType = (await response.headerValue('content-type')) ?? ''

      let bodyText: string | undefined
      try {
        if (contentType.includes('json') || contentType.includes('text/html') || contentType.includes('text/plain')) {
          bodyText = await response.text()
        }
      } catch {}

      let postData: { mimeType: string; text: string } | undefined
      const pd = request.postData()
      if (pd) {
        postData = { mimeType: (await request.headerValue('content-type')) ?? 'application/json', text: pd }
      }

      entries.push({
        startedDateTime: new Date().toISOString(),
        time: 0,
        request: { method: request.method(), url, headers: requestHeaders, ...(postData ? { postData } : {}) },
        response: {
          status,
          statusText: response.statusText(),
          headers: responseHeaders,
          content: { size: bodyText?.length ?? 0, mimeType: contentType, text: bodyText },
        },
      })
    } catch {}
  })

  // Navigate to dashboard to discover team
  await page.goto('https://app.netlify.com/', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(3000)

  const currentUrl = page.url()
  const teamMatch = currentUrl.match(/app\.netlify\.com\/teams\/([^/]+)/)
  const team = teamMatch?.[1]

  const pages = ['https://app.netlify.com/']
  if (team) {
    pages.push(
      `https://app.netlify.com/teams/${team}/sites`,
      `https://app.netlify.com/teams/${team}/builds`,
      `https://app.netlify.com/teams/${team}/plugins`,
      `https://app.netlify.com/teams/${team}/members`,
      `https://app.netlify.com/teams/${team}/dns`,
      `https://app.netlify.com/teams/${team}/audit-log`,
    )
  }

  for (const url of pages.slice(1)) {
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
    source: 'scripts/record-netlify-dynamic.ts',
    flow_count: pages.length,
    entry_count: entries.length,
    team_discovered: team ?? null,
  }, null, 2))

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
  await browser.close()
}

await main()
