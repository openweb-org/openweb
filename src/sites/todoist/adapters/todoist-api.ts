import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Todoist adapter — same-origin v1 API via bearer token interception.
 *
 * The web app at app.todoist.com makes API calls to /api/v1/ with a
 * Bearer token. This adapter intercepts one such request to extract the
 * token, then uses same-origin relative URLs for all operations.
 */

const API_BASE = '/api/v1'

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
    (req) => req.url().includes('/api/v1/') && !!req.headers().authorization,
    { timeout: 15_000 },
  )

  // Navigate to trigger API calls
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

  // 204 No Content (complete/uncomplete/delete)
  if (result.status === 204 || !result.text) return { success: true }

  return JSON.parse(result.text)
}

/** Normalize v1 project to spec shape */
function normalizeProject(p: Record<string, unknown>): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    parent_id: p.parent_id ?? null,
    order: p.child_order ?? p.order ?? 0,
    comment_count: p.comment_count ?? 0,
    is_shared: p.is_shared ?? false,
    is_favorite: p.is_favorite ?? false,
    is_inbox_project: p.inbox_project ?? false,
    view_style: p.view_style ?? 'list',
    url: p.url ?? `https://app.todoist.com/app/project/${p.id}`,
  }
}

/** Normalize v1 item to spec task shape */
function normalizeTask(t: Record<string, unknown>): Record<string, unknown> {
  return {
    id: t.id,
    content: t.content,
    description: t.description ?? '',
    project_id: t.project_id,
    section_id: t.section_id ?? null,
    parent_id: t.parent_id ?? null,
    order: t.child_order ?? t.order ?? 0,
    priority: t.priority ?? 1,
    due: t.due ?? null,
    labels: t.labels ?? [],
    comment_count: t.comment_count ?? 0,
    is_completed: t.checked ?? t.is_completed ?? false,
    creator_id: t.added_by_uid ?? t.creator_id ?? '',
    created_at: t.added_at ?? t.created_at ?? '',
    url: t.url ?? `https://app.todoist.com/app/task/${t.id}`,
  }
}

/** Normalize v1 created-task response to spec shape */
function normalizeCreatedTask(t: Record<string, unknown>): Record<string, unknown> {
  return {
    id: t.id,
    content: t.content,
    description: t.description ?? '',
    project_id: t.project_id,
    priority: t.priority ?? 1,
    due: t.due ?? null,
    labels: t.labels ?? [],
    url: t.url ?? `https://app.todoist.com/app/task/${t.id}`,
  }
}

const adapter: CustomRunner = {
  name: 'todoist-api',
  description: 'Todoist v1 API — projects, tasks, create, complete, uncomplete, delete',

  async run(ctx) {
    const { page: pageRaw, operation, params, helpers } = ctx
    const page = pageRaw as Page
    const { errors } = helpers as { errors: Errors }

    switch (operation) {
      case 'getProjects': {
        const raw = await apiFetch(page, 'GET', '/projects', null, errors) as Record<string, unknown>
        const results = (raw.results ?? raw) as Record<string, unknown>[]
        return results.map(normalizeProject)
      }

      case 'getTasks': {
        const qs = new URLSearchParams()
        if (params.project_id) qs.set('project_id', String(params.project_id))
        if (params.label) qs.set('label', String(params.label))
        if (params.filter) qs.set('filter', String(params.filter))
        const query = qs.toString()
        const raw = await apiFetch(page, 'GET', `/tasks${query ? `?${query}` : ''}`, null, errors) as Record<string, unknown>
        const results = (raw.results ?? raw) as Record<string, unknown>[]
        return results.map(normalizeTask)
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
        const raw = await apiFetch(page, 'POST', '/tasks', body, errors) as Record<string, unknown>
        return normalizeCreatedTask(raw)
      }

      case 'completeTask': {
        let taskId = params.task_id as string | undefined
        if (!taskId) throw errors.missingParam('task_id')
        let cleanup: string | undefined
        if (taskId === 'PLACEHOLDER') {
          const seed = await apiFetch(page, 'POST', '/tasks', { content: '_openweb_verify_complete' }, errors) as Record<string, unknown>
          taskId = seed.id as string
          cleanup = taskId
        }
        const result = await apiFetch(page, 'POST', `/tasks/${encodeURIComponent(taskId)}/close`, null, errors)
        if (cleanup) await apiFetch(page, 'DELETE', `/tasks/${encodeURIComponent(cleanup)}`, null, errors).catch(() => {})
        return result
      }

      case 'uncompleteTask': {
        let taskId = params.task_id as string | undefined
        if (!taskId) throw errors.missingParam('task_id')
        let cleanup: string | undefined
        if (taskId === 'PLACEHOLDER') {
          const seed = await apiFetch(page, 'POST', '/tasks', { content: '_openweb_verify_uncomplete' }, errors) as Record<string, unknown>
          taskId = seed.id as string
          cleanup = taskId
          await apiFetch(page, 'POST', `/tasks/${encodeURIComponent(taskId)}/close`, null, errors)
        }
        const result = await apiFetch(page, 'POST', `/tasks/${encodeURIComponent(taskId)}/reopen`, null, errors)
        if (cleanup) await apiFetch(page, 'DELETE', `/tasks/${encodeURIComponent(cleanup)}`, null, errors).catch(() => {})
        return result
      }

      case 'deleteTask': {
        let taskId = params.task_id as string | undefined
        if (!taskId) throw errors.missingParam('task_id')
        if (taskId === 'PLACEHOLDER') {
          const seed = await apiFetch(page, 'POST', '/tasks', { content: '_openweb_verify_delete' }, errors) as Record<string, unknown>
          taskId = seed.id as string
        }
        return apiFetch(page, 'DELETE', `/tasks/${encodeURIComponent(taskId)}`, null, errors)
      }

      default:
        throw errors.unknownOp(operation)
    }
  },
}

export default adapter
