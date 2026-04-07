import type { Page } from 'patchright'

/**
 * Fidelity adapter — browser-context API calls to digital.fidelity.com.
 *
 * All 7 page-transport ops are JSON POST endpoints behind CSRF protection.
 * The adapter navigates to the research page first, fetches the CSRF token,
 * then calls the API from the browser context (cookies + CSRF).
 */

const BASE = 'https://digital.fidelity.com'
const RESEARCH_PAGE = `${BASE}/research/quote-and-research/`

/** Navigate to Fidelity research page if not already there. */
async function navigateToSite(page: Page): Promise<void> {
  if (!page.url().includes('fidelity.com')) {
    await page.goto(RESEARCH_PAGE, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForTimeout(2000)
  }
}

/** Fetch CSRF token and call a Fidelity API endpoint from browser context. */
async function apiFetch(page: Page, path: string, body: Record<string, unknown>): Promise<unknown> {
  await navigateToSite(page)
  return page.evaluate(
    async (args: { base: string; path: string; body: Record<string, unknown> }) => {
      // Fetch CSRF token (best-effort — read-only APIs may work without it)
      let csrf = ''
      try {
        const tokenResp = await fetch(`${args.base}/prgw/digital/research/api/tokens`, { credentials: 'include' })
        if (tokenResp.ok) {
          const tokenData = await tokenResp.json()
          csrf = tokenData.csrfToken ?? ''
        }
      } catch { /* proceed without CSRF */ }

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
      if (csrf) headers['X-CSRF-TOKEN'] = csrf

      // Call the actual API
      const resp = await fetch(`${args.base}${args.path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args.body),
        credentials: 'include',
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${args.path}`)
      return resp.json()
    },
    { base: BASE, path, body },
  )
}

/* ---------- Operations ---------- */

async function getQuote(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return apiFetch(page, '/prgw/digital/research/api/quote', {
    symbol: String(params.symbol ?? ''),
  })
}

async function getMarketSummary(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return apiFetch(page, '/prgw/digital/research/api/market-bar', {
    supportCrypto: String(params.supportCrypto ?? 'N'),
  })
}

async function getCompanyProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const symbols = Array.isArray(params.symbols) ? params.symbols : [String(params.symbols ?? '')]
  return apiFetch(page, '/prgw/digital/research/api/company-profile', { symbols })
}

async function getNewsHeadlines(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return apiFetch(page, '/prgw/digital/research/api/news-headlines', {
    symbol: String(params.symbol ?? ''),
    count: Number(params.count ?? 21),
  })
}

async function getIndexQuotes(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return apiFetch(page, '/prgw/digital/research/api/sector-research/index-quote', {
    symbol: String(params.symbol ?? ''),
  })
}

async function getResearchData(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return apiFetch(page, '/prgw/digital/research/api/pass-through', {
    method: String(params.method ?? 'GET'),
    apiTokenName: String(params.apiTokenName ?? ''),
    params: String(params.params ?? ''),
  })
}

async function getCompanyLogo(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return apiFetch(page, '/prgw/digital/research/api/company-logo', {
    fvSymbols: String(params.fvSymbols ?? ''),
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  getQuote,
  getMarketSummary,
  getCompanyProfile,
  getNewsHeadlines,
  getIndexQuotes,
  getResearchData,
  getCompanyLogo,
}

const adapter = {
  name: 'fidelity-api',
  description: 'Fidelity — browser-context API calls with CSRF for quotes, market data, company info, news, research',

  async init(page: Page): Promise<boolean> {
    // Navigate to fidelity.com if not already there
    if (!page.url().includes('fidelity.com')) {
      try {
        await page.goto(RESEARCH_PAGE, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        await page.waitForTimeout(2000)
      } catch {
        return false
      }
    }
    return page.url().includes('fidelity.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true // no auth required for research APIs
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: { unknownOp(op: string): Error; wrap(error: unknown): Error } }): Promise<unknown> {
    const { errors } = helpers
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw errors.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
