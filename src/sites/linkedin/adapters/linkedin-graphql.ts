import type { Page } from 'patchright'

/**
 * LinkedIn L3 adapter — GraphQL API via browser fetch.
 *
 * Solves the problem of rotating queryId hashes: LinkedIn deploys new
 * JS bundles frequently, changing the hash portion of queryIds like
 * `voyagerIdentityDashProfiles.34ead06db82a2cc9a778fac97f69ad6a`.
 *
 * On first use, the adapter scans all `<script src>` bundles on the page
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
}

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
  errors: { fatal(msg: string): Error },
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

// ── Per-operation dispatch ────────────────────────

type Errors = { unknownOp(op: string): Error; missingParam(name: string): Error; httpError(status: number): Error; fatal(msg: string): Error }

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  getProfile: async (page, params, errors) => {
    const variables = String(params.variables ?? '')
    if (!variables) throw errors.missingParam('variables')
    const queryName = QUERY_NAME.getProfile
    const queryId = await getQueryId(page, queryName, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  getFeed: async (page, params, errors) => {
    const variables = String(params.variables ?? '(count:10,sortOrder:RELEVANCE)')
    const queryName = QUERY_NAME.getFeed
    const queryId = await getQueryId(page, queryName, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  getCompany: async (page, params, errors) => {
    const variables = String(params.variables ?? '')
    if (!variables) throw errors.missingParam('variables')
    const queryName = QUERY_NAME.getCompany
    const queryId = await getQueryId(page, queryName, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },

  getNewsStorylines: async (page, params, errors) => {
    const variables = String(params.variables ?? '()')
    const queryName = QUERY_NAME.getNewsStorylines
    const queryId = await getQueryId(page, queryName, errors)
    return doGraphqlGet(page, queryId, variables, params.includeWebMetadata !== 'false', errors)
  },
}

async function doGraphqlGet(
  page: Page,
  queryId: string,
  variables: string,
  includeWebMetadata: boolean,
  errors: { httpError(status: number): Error },
): Promise<unknown> {
  const result = await graphqlGet(page, queryId, variables, includeWebMetadata) as { status: number; text: string }

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  return JSON.parse(result.text)
}

// ── Adapter export ────────────────────────────────

const adapter = {
  name: 'linkedin-graphql',
  description: 'LinkedIn GraphQL adapter with dynamic queryId resolution from JS bundles',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('linkedin.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.linkedin.com')
    return cookies.some(c => c.name === 'li_at')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: Errors }): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
