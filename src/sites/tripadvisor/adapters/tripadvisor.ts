import type { Page } from 'patchright'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

const CAPTCHA_POLL_MS = 2_000
const CAPTCHA_WAIT_MS = 30_000

async function isDataDomeBlocked(page: Page): Promise<boolean> {
  try {
    const url = page.url()
    if (url.includes('captcha-delivery.com') || url.includes('datadome')) return true
    return page.evaluate(() =>
      document.body?.innerHTML?.includes('captcha-delivery.com') ?? false,
    )
  } catch {
    return false
  }
}

async function waitForCaptchaResolution(page: Page, timeoutMs = CAPTCHA_WAIT_MS): Promise<void> {
  const start = Date.now()
  process.stderr.write(
    'DataDome CAPTCHA detected. Waiting for resolution (solve in browser if visible)...\n',
  )
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(CAPTCHA_POLL_MS)
    if (!(await isDataDomeBlocked(page))) {
      process.stderr.write('DataDome CAPTCHA resolved.\n')
      return
    }
  }
  throw Object.assign(
    new Error(
      'DataDome CAPTCHA not resolved. Run `openweb browser restart --no-headless`, solve the CAPTCHA, then retry.',
    ),
    { failureClass: 'bot_blocked' },
  )
}

/* ---------- searchLocation ----------
 * Kept on adapter: the TypeAheadJson endpoint is accessed via browser-side
 * fetch() which is blocked for spec-based page_global_data expressions. */

async function searchLocation(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query is required')

  return page.evaluate(`
    (async () => {
      const q = ${JSON.stringify(query)};
      try {
        const r = await fetch(
          'https://www.tripadvisor.com/TypeAheadJson?action=API&query=' + encodeURIComponent(q) + '&types=geo,hotel,restaurant,attraction',
          { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }
        );
        if (!r.ok) return { count: 0, results: [] };
        const data = await r.json();
        const items = (data.results || []);
        const seen = new Set();
        const results = [];
        for (const item of items) {
          const geoMatch = (item.url || item.urls?.[0]?.url || '').match(/-g(\\d+)-/);
          const geoId = geoMatch ? geoMatch[1] : (item.document_id || '');
          if (!geoId || seen.has(geoId)) continue;
          seen.add(geoId);
          const slugMatch = (item.url || item.urls?.[0]?.url || '').match(/-g\\d+-(.+?)(?:\\.html|-)/);
          results.push({
            geoId,
            name: item.name || '',
            type: (item.type || item.data_type || '').toLowerCase(),
            locationSlug: slugMatch ? slugMatch[1] : null,
            url: item.url || item.urls?.[0]?.url || null,
          });
        }
        return { count: results.length, results };
      } catch { return { count: 0, results: [] }; }
    })()
  `)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchLocation,
}

const adapter: CodeAdapter = {
  name: 'tripadvisor',
  description: 'TripAdvisor adapter — searchLocation via TypeAheadJson (other ops use spec-based extraction)',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('tripadvisor.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}. Available: ${Object.keys(OPERATIONS).join(', ')}`)
    }
    if (await isDataDomeBlocked(page)) {
      await waitForCaptchaResolution(page)
    }
    return handler(page, params)
  },
}

export default adapter
