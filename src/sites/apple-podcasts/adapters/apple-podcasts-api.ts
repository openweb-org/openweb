import type { Page } from 'patchright'

const AMP_API = 'https://amp-api.podcasts.apple.com'

type Errors = { needsLogin(): Error; httpError(status: number): Error; unknownOp(op: string): Error }

async function getDeveloperToken(page: Page, errors: Errors): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      return (window as any).MusicKit?.getInstance()?.developerToken as string | undefined
    } catch {
      return undefined
    }
  })
  if (!token) {
    throw errors.needsLogin()
  }
  return token
}

async function apiGet(
  page: Page,
  path: string,
  errors: Errors,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const token = await getDeveloperToken(page, errors)
  const url = new URL(`${AMP_API}${path}`)

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, String(v))
    } else {
      url.searchParams.set(key, String(value))
    }
  }

  const resp = await page.request.fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Origin: 'https://podcasts.apple.com',
      Referer: 'https://podcasts.apple.com/',
    },
  })

  if (!resp.ok()) {
    throw errors.httpError(resp.status())
  }

  return resp.json()
}

const DEFAULT_TYPES = 'podcasts,podcast-channels,podcast-episodes,categories,editorial-items'

/* ---------- operations ---------- */

async function searchPodcasts(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  return apiGet(page, '/v1/catalog/us/search/groups', errors, {
    term: params.term,
    platform: 'web',
    types: params.types ?? DEFAULT_TYPES,
    groups: params.groups ?? 'category,channel,episode,show,top',
    l: params.l ?? 'en-US',
    limit: params.limit ?? '25',
    extend: params.extend,
  })
}

async function getPodcast(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = params.id
  const queryParams: Record<string, unknown> = {
    l: params.l ?? 'en-US',
  }
  if (params.extend) queryParams.extend = params.extend
  if (params.include) queryParams.include = params.include
  if (params['limit[episodes]']) queryParams['limit[episodes]'] = params['limit[episodes]']

  return apiGet(page, `/v1/catalog/us/podcasts/${id}`, errors, queryParams)
}

async function getSearchSuggestions(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  return apiGet(page, '/v1/catalog/us/search/suggestions', errors, {
    term: params.term,
    platform: 'web',
    kinds: params.kinds ?? 'terms,topResults',
    types: params.types ?? DEFAULT_TYPES,
    l: params.l ?? 'en-US',
  })
}

async function getTopCharts(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  return apiGet(page, '/v1/editorial/us/groupings', errors, {
    name: params.name ?? 'search-landing',
    platform: 'web',
    l: params.l ?? 'en-US',
    with: params.with,
  })
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchPodcasts,
  getPodcast,
  getSearchSuggestions,
  getTopCharts,
}

const adapter = {
  name: 'apple-podcasts-api',
  description: 'Apple Podcasts AMP API — search, detail, suggestions, charts via MusicKit bearer token',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('podcasts.apple.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const token = await page.evaluate(() => {
      try {
        return !!(window as any).MusicKit?.getInstance()?.developerToken
      } catch {
        return false
      }
    })
    return token
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: Errors }): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw errors.unknownOp(operation)
    }
    return handler(page, { ...params }, errors)
  },
}

export default adapter
