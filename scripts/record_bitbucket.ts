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

  // Bitbucket public API 2.0 — list public repositories
  await page.goto('https://api.bitbucket.org/2.0/repositories?pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Search repositories by language
  await page.goto('https://api.bitbucket.org/2.0/repositories?q=language%3D%22python%22&pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Specific workspace repositories (atlassian is a public workspace)
  await page.goto('https://api.bitbucket.org/2.0/repositories/atlassian?pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Specific repository
  await page.goto('https://api.bitbucket.org/2.0/repositories/atlassian/aui', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Repository commits
  await page.goto('https://api.bitbucket.org/2.0/repositories/atlassian/aui/commits?pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Repository branches
  await page.goto('https://api.bitbucket.org/2.0/repositories/atlassian/aui/refs/branches?pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Repository pull requests
  await page.goto('https://api.bitbucket.org/2.0/repositories/atlassian/aui/pullrequests?state=OPEN&pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Repository source/file listing
  await page.goto('https://api.bitbucket.org/2.0/repositories/atlassian/aui/src', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Workspace members (public)
  await page.goto('https://api.bitbucket.org/2.0/workspaces/atlassian/members?pagelen=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await context.close()
  await browser.close()

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright',
    source: 'scripts/record_bitbucket.ts',
    flow_count: 9,
    har_path: harPath,
  }
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()
