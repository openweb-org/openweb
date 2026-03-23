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

  // GitLab public API v4 — projects
  await page.goto('https://gitlab.com/api/v4/projects?per_page=5&order_by=last_activity_at', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Search projects
  await page.goto('https://gitlab.com/api/v4/projects?search=kubernetes&per_page=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Specific project by ID (gitlab-org/gitlab = 278964)
  await page.goto('https://gitlab.com/api/v4/projects/278964', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Project issues
  await page.goto('https://gitlab.com/api/v4/projects/278964/issues?per_page=5&state=opened', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Project merge requests
  await page.goto('https://gitlab.com/api/v4/projects/278964/merge_requests?per_page=5&state=opened', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Project repository branches
  await page.goto('https://gitlab.com/api/v4/projects/278964/repository/branches?per_page=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Project pipelines
  await page.goto('https://gitlab.com/api/v4/projects/278964/pipelines?per_page=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Users search
  await page.goto('https://gitlab.com/api/v4/users?search=admin&per_page=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Groups
  await page.goto('https://gitlab.com/api/v4/groups?search=gitlab-org&per_page=5', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  // Specific group
  await page.goto('https://gitlab.com/api/v4/groups/9970', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {})
  await page.waitForTimeout(2000)

  await context.close()
  await browser.close()

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright',
    source: 'scripts/record_gitlab.ts',
    flow_count: 10,
    har_path: harPath,
  }
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()
