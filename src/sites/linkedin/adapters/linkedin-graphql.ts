import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * LinkedIn L3 runner — GraphQL API via browser fetch.
 *
 * Solves the problem of rotating queryId hashes: LinkedIn deploys new
 * JS bundles frequently, changing the hash portion of queryIds like
 * `voyagerIdentityDashProfiles.34ead06db82a2cc9a778fac97f69ad6a`.
 *
 * On first use, the runner scans all `<script src>` bundles on the page
 * for GraphQL query/mutation registrations and builds a name→queryId map.
 * The map is cached for the session lifetime.
 *
 * Auth (cookie_session) and CSRF (cookie_to_header JSESSIONID→csrf-token)
 * are resolved inline inside page.evaluate — no constant_headers needed.
 */

// ── Operation → LinkedIn internal query name mapping ──
// Maps our operationId → LinkedIn's internal GraphQL query registration name.
// These names are stable across deploys; only the hashes rotate.

const QUERY_NAME: Record<string, string> = {
  getProfile: 'web-top-card-core-query',
  getFeed: 'relevance-feed',
  getCompany: 'organization-by-name-guide-fetcher-query',
  getNewsStorylines: 'breaking-news',
  // searchJobs uses REST API (voyagerJobsDashJobCards) — no GraphQL query name needed
  getJobDetail: 'full-job-posting-detail-section',
}

type Errors = AdapterHelpers['errors']

// ── QueryId extraction ────────────────────────────

/**
 * Scan all JS bundles on the page and extract GraphQL query registrations.
 * LinkedIn registers queries via a pattern like:
 *   {kind:"query", id:"voyagerModule.HASH", typeName:"...", name:"human-readable-name"}
 *
 * Returns a map of name → full queryId (e.g. "web-top-card-core-query" → "voyagerIdentityDashProfiles.34ea...").
 */
async function loadQueryIds(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const scripts = Array.from(document.querySelectorAll('script[src]'))
    const urls = scripts.map(s => s.src)

    const map: Record<string, string> = {}
    const re = /kind:"(?:query|mutation)",id:"(voyager[A-Za-z]+Dash[A-Za-z]+\.[a-f0-9]{32})",typeName:"[^"]+",name:"([^"]+)"/g

    // Fetch bundles in parallel (batch of 6 to avoid hammering)
    const BATCH = 6
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH)
      const texts = await Promise.all(
        batch.map(async url => {
          try {
            const resp = await fetch(url)
            return await resp.text()
          } catch {
            return ''
          }
        }),
      )
      for (const text of texts) {
        let m: RegExpExecArray | null = re.exec(text)
        while (m !== null) {
          map[m[2]] = m[1] // name → queryId
          m = re.exec(text)
        }
      }
    }

    return map
  })
}

// ── QueryId cache ─────────────────────────────────

let cachedQueryIds: Record<string, string> | null = null

async function getQueryId(
  page: Page,
  linkedinQueryName: string,
  errors: Errors,
): Promise<string> {
  if (!cachedQueryIds) {
    cachedQueryIds = await loadQueryIds(page)
  }
  const id = cachedQueryIds[linkedinQueryName]
  if (!id) throw errors.fatal(`QueryId not found for "${linkedinQueryName}". LinkedIn may have renamed this query.`)
  return id
}

// ── GraphQL request helper ────────────────────────

async function graphqlGet(
  page: Page,
  queryId: string,
  variables: string,
  includeWebMetadata: boolean,
): Promise<unknown> {
  return page.evaluate(
    async (args: { queryId: string; variables: string; includeWebMetadata: boolean }) => {
      // Resolve CSRF token from JSESSIONID cookie
      const cookies = document.cookie.split(';').map(c => c.trim())
      const jsessionCookie = cookies.find(c => c.startsWith('JSESSIONID='))
      // JSESSIONID value is quoted: "ajax:123..." — strip quotes
      const csrfToken = jsessionCookie
        ? jsessionCookie.split('=').slice(1).join('=').replace(/^"|"$/g, '')
        : ''

      // Build URL without encoding variables — LinkedIn's Rest.li tuple format
      // uses parentheses and colons that must NOT be percent-encoded.
      const parts = [`variables=${args.variables}`, `queryId=${args.queryId}`]
      if (args.includeWebMetadata) parts.push('includeWebMetadata=true')
      const url = `https://www.linkedin.com/voyager/api/graphql?${parts.join('&')}`

      const resp = await fetch(url, {
        headers: {
          Accept: 'application/vnd.linkedin.normalized+json+2.1',
          'csrf-token': csrfToken,
          'x-restli-protocol-version': '2.0.0',
        },
        credentials: 'include',
      })
      const text = await resp.text()
      return { status: resp.status, text }
    },
    { queryId, variables, includeWebMetadata },
  )
}

// ── REST API request helper ──────────────────────

/**
 * LinkedIn's job search moved from GraphQL to a REST API endpoint.
 * /voyager/api/voyagerJobsDashJobCards?decorationId=...&q=jobSearch&query=(...)
 */
async function restGet(
  page: Page,
  path: string,
  queryParts: string[],
): Promise<unknown> {
  return page.evaluate(
    async (args: { path: string; queryParts: string[] }) => {
      const cookies = document.cookie.split(';').map(c => c.trim())
      const jsessionCookie = cookies.find(c => c.startsWith('JSESSIONID='))
      const csrfToken = jsessionCookie
        ? jsessionCookie.split('=').slice(1).join('=').replace(/^"|"$/g, '')
        : ''

      const url = `https://www.linkedin.com${args.path}?${args.queryParts.join('&')}`

      const resp = await fetch(url, {
        headers: {
          Accept: 'application/vnd.linkedin.normalized+json+2.1',
          'csrf-token': csrfToken,
          'x-restli-protocol-version': '2.0.0',
        },
        credentials: 'include',
      })
      const text = await resp.text()
      return { status: resp.status, text }
    },
    { path, queryParts },
  )
}

async function doGraphqlGet(
  page: Page,
  queryId: string,
  variables: string,
  includeWebMetadata: boolean,
  errors: Errors,
): Promise<unknown> {
  const result = await graphqlGet(page, queryId, variables, includeWebMetadata) as { status: number; text: string }

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  return JSON.parse(result.text)
}

// ── Per-operation dispatch ────────────────────────

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  getProfile: async (page, params, helpers) => {
    const { errors } = helpers
    const variables = String(params.variables ?? '')
    if (!variables) throw errors.missingParam('variables')
    const queryId = await getQueryId(page, QUERY_NAME.getProfile, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  getFeed: async (page, params, helpers) => {
    const { errors } = helpers
    const variables = String(params.variables ?? '(count:10,sortOrder:RELEVANCE)')
    const queryId = await getQueryId(page, QUERY_NAME.getFeed, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  getCompany: async (page, params, helpers) => {
    const { errors } = helpers
    const variables = String(params.variables ?? '')
    if (!variables) throw errors.missingParam('variables')
    const queryId = await getQueryId(page, QUERY_NAME.getCompany, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  getNewsStorylines: async (page, params, helpers) => {
    const { errors } = helpers
    const variables = String(params.variables ?? '()')
    const queryId = await getQueryId(page, QUERY_NAME.getNewsStorylines, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  searchJobs: async (page, params, helpers) => {
    const { errors } = helpers
    const keywords = String(params.keywords ?? '')
    if (!keywords) throw errors.missingParam('keywords')
    const count = Number(params.count ?? 25)
    const start = Number(params.start ?? 0)
    const geoId = params.geoId ? String(params.geoId) : ''

    const encoded = encodeURIComponent(keywords)
    let query = `(origin:JOB_SEARCH_PAGE_OTHER_ENTRY,keywords:${encoded}`
    if (geoId) query += `,locationUnion:(geoId:${geoId})`
    query += ',selectedFilters:(sortBy:List(DD)))'

    const decorationId = encodeURIComponent(
      'com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollectionLite-88',
    )

    const queryParts = [
      `decorationId=${decorationId}`,
      `count=${count}`,
      'q=jobSearch',
      `query=${query}`,
      `start=${start}`,
    ]

    const result = (await restGet(page, '/voyager/api/voyagerJobsDashJobCards', queryParts)) as {
      status: number
      text: string
    }
    if (result.status >= 400) throw errors.httpError(result.status)
    return JSON.parse(result.text)
  },

  getJobDetail: async (page, params, helpers) => {
    const { errors } = helpers
    const jobId = String(params.jobId ?? '')
    if (!jobId) throw errors.missingParam('jobId')
    const variables = `(cardSectionTypes:List(TOP_CARD,HOW_YOU_FIT_CARD),jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A${jobId},includeSecondaryActionsV2:true,jobDetailsContext:(isJobSearch:true))`
    const queryId = await getQueryId(page, QUERY_NAME.getJobDetail, errors)
    return doGraphqlGet(page, queryId, variables, true, errors)
  },
}

// ── Runner export ─────────────────────────────────

const runner: CustomRunner = {
  name: 'linkedin-graphql',
  description: 'LinkedIn GraphQL adapter with dynamic queryId resolution from JS bundles',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('linkedin-graphql requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
