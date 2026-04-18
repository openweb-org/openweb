import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Fidelity adapter — fetch CSRF + call API both inside the browser context.
 *
 * The runtime's api_response CSRF resolver fetches /tokens via node fetch with
 * cookies copied from the browser; the response Set-Cookie is not synced back.
 * Fidelity ties the CSRF token to the cookie set returned alongside it, so the
 * subsequent page.evaluate(fetch(...)) API call sees the token but not its
 * matching cookie → 401. Doing both fetches via page.evaluate keeps cookies
 * coherent. Page navigation to /research/quote-and-research/ is handled by
 * server-level page_plan.
 */

const BASE = 'https://digital.fidelity.com'

interface OpDef {
  readonly path: string
  readonly buildBody: (params: Record<string, unknown>) => Record<string, unknown>
}

const OPS: Record<string, OpDef> = {
  getQuote: {
    path: '/prgw/digital/research/api/quote',
    buildBody: p => ({ symbol: String(p.symbol ?? '') }),
  },
  getMarketSummary: {
    path: '/prgw/digital/research/api/market-bar',
    buildBody: p => ({ supportCrypto: String(p.supportCrypto ?? 'N') }),
  },
  getCompanyProfile: {
    path: '/prgw/digital/research/api/company-profile',
    buildBody: p => ({
      symbols: Array.isArray(p.symbols) ? p.symbols : [String(p.symbols ?? '')],
    }),
  },
  getNewsHeadlines: {
    path: '/prgw/digital/research/api/news-headlines',
    buildBody: p => ({
      symbol: String(p.symbol ?? ''),
      count: Number(p.count ?? 21),
    }),
  },
  getIndexQuotes: {
    path: '/prgw/digital/research/api/sector-research/index-quote',
    buildBody: p => ({ symbol: String(p.symbol ?? '') }),
  },
  getResearchData: {
    path: '/prgw/digital/research/api/pass-through',
    buildBody: p => ({
      method: String(p.method ?? 'GET'),
      apiTokenName: String(p.apiTokenName ?? ''),
      params: String(p.params ?? ''),
    }),
  },
  getCompanyLogo: {
    path: '/prgw/digital/research/api/company-logo',
    buildBody: p => ({ fvSymbols: String(p.fvSymbols ?? '') }),
  },
}

async function callInBrowser(page: Page, path: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async (args: { base: string; path: string; body: Record<string, unknown> }) => {
      const tokenResp = await fetch(`${args.base}/prgw/digital/research/api/tokens`, { credentials: 'include' })
      let csrf = ''
      if (tokenResp.ok) {
        const tokenData = await tokenResp.json() as { csrfToken?: string }
        csrf = tokenData.csrfToken ?? ''
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
      if (csrf) headers['X-CSRF-TOKEN'] = csrf
      const resp = await fetch(`${args.base}${args.path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args.body),
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { base: BASE, path, body },
  )
}

const adapter: CustomRunner = {
  name: 'fidelity-api',
  description: 'Fidelity — browser-context CSRF + API for digital.fidelity.com research endpoints',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers
    const def = OPS[operation]
    if (!def) throw errors.unknownOp(operation)
    if (!page) throw errors.fatal('fidelity adapter requires a browser page')

    const resp = await callInBrowser(page, def.path, def.buildBody({ ...params }))
    if (resp.status >= 400) throw errors.httpError(resp.status)
    return JSON.parse(resp.text)
  },
}

export default adapter
