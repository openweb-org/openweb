import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * GitHub web-UI adapter — routes write ops through github.com (rails + persisted-query
 * GraphQL) instead of api.github.com REST, which rejects cookie_session auth.
 *
 * Endpoints discovered via HAR capture (2026-04-19):
 *   - star/unstar: POST /<owner>/<repo>/{star,unstar} multipart, authenticity_token from form
 *   - watch/unwatch: POST /notifications/subscribe multipart, do=subscribed|included
 *   - close/reopen: POST /_graphql persisted-query (hashes captured below — drift expected)
 *
 * All requests need X-Fetch-Nonce (from <meta name="fetch-nonce">) and
 * GitHub-Verified-Fetch: true headers.
 */

const PERSISTED_HASHES = {
  closeIssue: '73f1d13c27e76443f6a9a809ccb4f6e6',
  closeIssueName: 'updateIssueStateMutationCloseMutation',
  reopenIssue: 'a6677fa25f66fdc23d4dbe44f4e62757',
  reopenIssueName: 'updateIssueStateMutation',
}

type Errors = AdapterHelpers['errors']

interface RepoCtx {
  readonly nonce: string
  readonly repoId: string
  readonly unstarToken: string | null
}

interface IssueCtx {
  readonly nonce: string
  readonly issueNodeId: string
}

async function navigateAndExtractRepo(page: Page, owner: string, repo: string, errors: Errors): Promise<RepoCtx> {
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  const ctx = await page.evaluate(() => ({
    nonce: document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content') ?? '',
    repoId: document.querySelector('meta[name="octolytics-dimension-repository_id"]')?.getAttribute('content') ?? '',
    unstarToken: document.querySelector('form[action$="/unstar"] input[name="authenticity_token"]')?.getAttribute('value') ?? null,
    starToken: document.querySelector('form[action$="/star"] input[name="authenticity_token"]')?.getAttribute('value') ?? null,
    loggedIn: document.body.classList.contains('logged-in'),
  }))
  if (!ctx.loggedIn) throw errors.needsLogin()
  if (!ctx.nonce || !ctx.repoId) throw errors.fatal('Could not extract fetch-nonce or repo id from repo page')
  return { nonce: ctx.nonce, repoId: ctx.repoId, unstarToken: ctx.unstarToken ?? ctx.starToken }
}

async function navigateAndExtractIssue(page: Page, owner: string, repo: string, num: number, errors: Errors): Promise<IssueCtx> {
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${num}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  // Issue node ID is embedded in the React data; wait briefly for hydration
  await page.waitForFunction(
    () => /I_kwDO[A-Za-z0-9_-]{10,}/.test(document.documentElement.outerHTML),
    null,
    { timeout: 15_000 },
  ).catch(() => {})
  const ctx = await page.evaluate(() => {
    const m = document.documentElement.outerHTML.match(/I_kwDO[A-Za-z0-9_-]{10,}/)
    return {
      nonce: document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content') ?? '',
      issueNodeId: m?.[0] ?? '',
      loggedIn: document.body.classList.contains('logged-in'),
    }
  })
  if (!ctx.loggedIn) throw errors.needsLogin()
  if (!ctx.nonce) throw errors.fatal('Could not extract fetch-nonce from issue page')
  if (!ctx.issueNodeId) throw errors.fatal(`Issue #${num} not found or has no global node id (page may be 404)`)
  return { nonce: ctx.nonce, issueNodeId: ctx.issueNodeId }
}

/** POST a multipart form via in-page fetch — preserves cookies + same-origin context. */
async function postMultipart(
  page: Page,
  url: string,
  fields: Record<string, string>,
  nonce: string,
  errors: Errors,
): Promise<unknown> {
  const result = await page.evaluate(
    async ({ url, fields, nonce }) => {
      const form = new FormData()
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Fetch-Nonce': nonce,
          'GitHub-Verified-Fetch': 'true',
        },
        body: form,
      })
      const text = await resp.text()
      return { status: resp.status, text: text.slice(0, 4000) }
    },
    { url, fields, nonce },
  )
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`GitHub web POST ${url} → HTTP ${result.status}: ${result.text.slice(0, 200)}`)
  return tryJson(result.text)
}

/** POST a github persisted-query mutation to /_graphql. */
async function postPersistedMutation(
  page: Page,
  persistedQueryName: string,
  hash: string,
  variables: Record<string, unknown>,
  nonce: string,
  errors: Errors,
): Promise<unknown> {
  const result = await page.evaluate(
    async ({ persistedQueryName, hash, variables, nonce }) => {
      const body = JSON.stringify({ persistedQueryName, query: hash, variables })
      const resp = await fetch('https://github.com/_graphql', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Fetch-Nonce': nonce,
          'GitHub-Verified-Fetch': 'true',
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body,
      })
      const text = await resp.text()
      return { status: resp.status, text: text.slice(0, 4000) }
    },
    { persistedQueryName, hash, variables, nonce },
  )
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`/_graphql ${persistedQueryName} → HTTP ${result.status}: ${result.text.slice(0, 200)}`)
  const parsed = tryJson(result.text) as Record<string, unknown> | null
  if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const msg = (parsed.errors[0] as Record<string, unknown>).message ?? 'unknown'
    throw errors.fatal(`/_graphql ${persistedQueryName} returned errors: ${msg}`)
  }
  return parsed
}

function tryJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  async closeIssue(page, params, helpers) {
    const owner = String(params.owner || '')
    const repo = String(params.repo || '')
    const num = Number(params.issue_number)
    if (!owner || !repo || !num) throw helpers.errors.missingParam('owner|repo|issue_number')
    const ctx = await navigateAndExtractIssue(page, owner, repo, num, helpers.errors)
    return postPersistedMutation(
      page,
      PERSISTED_HASHES.closeIssueName,
      PERSISTED_HASHES.closeIssue,
      { duplicateIssueId: null, id: ctx.issueNodeId, newStateReason: 'COMPLETED' },
      ctx.nonce,
      helpers.errors,
    )
  },

  async reopenIssue(page, params, helpers) {
    const owner = String(params.owner || '')
    const repo = String(params.repo || '')
    const num = Number(params.issue_number)
    if (!owner || !repo || !num) throw helpers.errors.missingParam('owner|repo|issue_number')
    const ctx = await navigateAndExtractIssue(page, owner, repo, num, helpers.errors)
    return postPersistedMutation(
      page,
      PERSISTED_HASHES.reopenIssueName,
      PERSISTED_HASHES.reopenIssue,
      { id: ctx.issueNodeId },
      ctx.nonce,
      helpers.errors,
    )
  },

  async watchRepo(page, params, helpers) {
    const owner = String(params.owner || '')
    const repo = String(params.repo || '')
    if (!owner || !repo) throw helpers.errors.missingParam('owner|repo')
    const ctx = await navigateAndExtractRepo(page, owner, repo, helpers.errors)
    return postMultipart(
      page,
      'https://github.com/notifications/subscribe',
      { do: 'subscribed', 'thread_types[]': '', repository_id: ctx.repoId },
      ctx.nonce,
      helpers.errors,
    )
  },

  async unwatchRepo(page, params, helpers) {
    const owner = String(params.owner || '')
    const repo = String(params.repo || '')
    if (!owner || !repo) throw helpers.errors.missingParam('owner|repo')
    const ctx = await navigateAndExtractRepo(page, owner, repo, helpers.errors)
    // "included" reverts to default Participating state — equivalent to unwatch
    return postMultipart(
      page,
      'https://github.com/notifications/subscribe',
      { do: 'included', 'thread_types[]': '', repository_id: ctx.repoId },
      ctx.nonce,
      helpers.errors,
    )
  },

  async unstarRepo(page, params, helpers) {
    const owner = String(params.owner || '')
    const repo = String(params.repo || '')
    if (!owner || !repo) throw helpers.errors.missingParam('owner|repo')
    const ctx = await navigateAndExtractRepo(page, owner, repo, helpers.errors)
    if (!ctx.unstarToken) throw helpers.errors.fatal('No authenticity_token found in star/unstar form (repo page may not be loaded)')
    const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/unstar`
    return postMultipart(
      page,
      url,
      { authenticity_token: ctx.unstarToken, context: 'repository' },
      ctx.nonce,
      helpers.errors,
    )
  },
}

const runner: CustomRunner = {
  name: 'github-web',
  description: 'GitHub web-UI write ops (rails + persisted-query) routed through github.com',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('github-web requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
