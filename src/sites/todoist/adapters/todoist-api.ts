import type { Page } from 'patchright'

/**
 * Todoist adapter — REST API v2 via bearer token extraction.
 *
 * The Todoist web app (app.todoist.com) makes REST API calls to
 * api.todoist.com with a Bearer token in the Authorization header.
 * This adapter intercepts a request to extract that token, then
 * makes direct API calls for all operations.
 */

const API_BASE = 'https://api.todoist.com/rest/v2'

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  httpError(status: number): Error
  apiError(label: string, msg: string): Error
  needsLogin(msg: string): Error
}

let cachedToken: string | null = null

async function extractToken(page: Page, errors: Errors): Promise<string> {
  const requestPromise = page.waitForRequest(
    (req) => req.url().includes('api.todoist.com') && !!req.headers().authorization,
    { timeout: 15_000 },
  )

  // Navigate to trigger an API call
  page.goto('https://app.todoist.com/app/today', { waitUntil: 'domcontentloaded' }).catch(() => {})

  const request = await requestPromise.catch(() => null)
  if (!request) {
    throw errors.needsLogin('Could not extract Todoist bearer token. Please log in to app.todoist.com first.')
  }

  const auth = request.headers().authorization ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) {
    throw errors.needsLogin('No bearer token found in Todoist API requests. Please log in.')
  }

  return token
}

async function apiFetch(
  page: Page,
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  errors: Errors,
): Promise<unknown> {
  if (!cachedToken) {
    cachedToken = await extractToken(page, errors)
  }

  const result = await page.evaluate(
    async (args: { base: string; method: string; path: string; body: string | null; token: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const opts: RequestInit = {
          method: args.method,
          headers: {
            Authorization: `Bearer ${args.token}`,
            'Content-Type': 'application/json',
          },
          signal: ctrl.signal,
        }
        if (args.body) opts.body = args.body
        const resp = await fetch(`${args.base}${args.path}`, opts)
        const text = await resp.text()
        return { status: resp.status, text }
      } finally {
        clearTimeout(timer)
      }
    },
    { base: API_BASE, method, path, body: body ? JSON.stringify(body) : null, token: cachedToken },
  )

  // Retry with fresh token on 401/403
  if (result.status === 401 || result.status === 403) {
    cachedToken = await extractToken(page, errors)
    const retry = await page.evaluate(
      async (args: { base: string; method: string; path: string; body: string | null; token: string }) => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 15_000)
        try {
          const opts: RequestInit = {
            method: args.method,
            headers: {
              Authorization: `Bearer ${args.token}`,
              'Content-Type': 'application/json',
            },
            signal: ctrl.signal,
          }
          if (args.body) opts.body = args.body
          const resp = await fetch(`${args.base}${args.path}`, opts)
          const text = await resp.text()
          return { status: resp.status, text }
        } finally {
          clearTimeout(timer)
        }
      },
      { base: API_BASE, method, path, body: body ? JSON.stringify(body) : null, token: cachedToken },
    )
    if (retry.status >= 400) throw errors.httpError(retry.status)
    return retry.text ? JSON.parse(retry.text) : { success: true }
  }

  if (result.status >= 400) throw errors.httpError(result.status)

  // 204 No Content (completeTask)
  if (result.status === 204 || !result.text) return { success: true }

  return JSON.parse(result.text)
}

const adapter = {
  name: 'todoist-api',
  description: 'Todoist REST API v2 — projects, tasks, create, complete',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('todoist.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://app.todoist.com')
    return cookies.some((c) => c.name === 'td_session')
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: Errors }

    switch (operation) {
      case 'getProjects':
        return apiFetch(page, 'GET', '/projects', null, errors)

      case 'getTasks': {
        const qs = new URLSearchParams()
        if (params.project_id) qs.set('project_id', String(params.project_id))
        if (params.label) qs.set('label', String(params.label))
        if (params.filter) qs.set('filter', String(params.filter))
        const query = qs.toString()
        return apiFetch(page, 'GET', `/tasks${query ? `?${query}` : ''}`, null, errors)
      }

      case 'createTask': {
        const content = params.content as string | undefined
        if (!content) throw errors.missingParam('content')
        const body: Record<string, unknown> = { content }
        if (params.description) body.description = params.description
        if (params.project_id) body.project_id = params.project_id
        if (params.due_string) body.due_string = params.due_string
        if (params.due_date) body.due_date = params.due_date
        if (params.priority) body.priority = params.priority
        if (params.labels) body.labels = params.labels
        return apiFetch(page, 'POST', '/tasks', body, errors)
      }

      case 'completeTask': {
        const taskId = params.task_id as string | undefined
        if (!taskId) throw errors.missingParam('task_id')
        return apiFetch(page, 'POST', `/tasks/${encodeURIComponent(taskId)}/close`, null, errors)
      }

      default:
        throw errors.unknownOp(operation)
    }
  },
}

export default adapter
