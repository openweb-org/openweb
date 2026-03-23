/**
 * Check login status for all target sites via managed Chrome CDP.
 */
import { chromium } from 'playwright'

const sites = [
  { name: 'todoist', url: 'https://app.todoist.com/app/today', loginPatterns: ['auth', 'login'] },
  { name: 'sentry', url: 'https://sentry.io/organizations/', loginPatterns: ['login', 'auth'] },
  { name: 'netlify', url: 'https://app.netlify.com/', loginPatterns: ['login', 'auth'] },
  { name: 'vercel', url: 'https://vercel.com/dashboard', loginPatterns: ['login', 'signup'] },
  { name: 'supabase', url: 'https://supabase.com/dashboard/projects', loginPatterns: ['sign-in', 'login'] },
  { name: 'shortcut', url: 'https://app.shortcut.com/', loginPatterns: ['login', 'signin'] },
  { name: 'terraform-cloud', url: 'https://app.terraform.io/app', loginPatterns: ['login', 'session'] },
]

const browser = await chromium.connectOverCDP('http://localhost:9222')
const context = browser.contexts()[0]

for (const site of sites) {
  const page = await context.newPage()
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(3000)
    const finalUrl = page.url()
    const isLoggedOut = site.loginPatterns.some(p => finalUrl.includes(p))
    console.log(`${site.name}: ${isLoggedOut ? 'NOT_LOGGED_IN' : 'LOGGED_IN'} — ${finalUrl}`)
  } catch (e) {
    console.log(`${site.name}: ERROR — ${(e as Error).message}`)
  } finally {
    await page.close()
  }
}

await browser.close()
