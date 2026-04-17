import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

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

async function searchLocation(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw helpers.errors.missingParam('query')

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

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  searchLocation,
}

const runner: CustomRunner = {
  name: 'tripadvisor',
  description: 'TripAdvisor adapter — searchLocation via TypeAheadJson (other ops use spec-based extraction)',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('tripadvisor requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    if (await isDataDomeBlocked(page)) {
      await waitForCaptchaResolution(page)
    }
    return handler(page, params, helpers)
  },
}

export default runner
