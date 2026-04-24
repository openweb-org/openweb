import type { Page } from 'patchright'

import type { CustomRunner, AdapterHelpers, AdapterErrorHelpers, AuthResult } from '../../../types/adapter.js'

const API = 'https://chatgpt.com/backend-api'

type R = Record<string, unknown>

const STRIP_KEYS = new Set([
  'pinned_time', 'conversation_template_id',
  'is_temporary_chat', 'is_do_not_remember',
  'memory_scope', 'context_scopes', 'context_scopes_v2',
  'workspace_id', 'async_status',
  'safe_urls', 'blocked_urls',
  'conversation_origin', 'sugar_item_id', 'sugar_item_visible',
  'moderation_results', 'plugin_ids',
  'gizmo_type', 'atlas_mode_enabled',
  'is_read_only', 'voice',
  'disabled_tool_ids', 'is_study_mode', 'owner',
  'end_turn', 'metadata', 'recipient', 'channel',
  'has_payg_project_spend_limit', 'amr', 'claimed_domain_org_id',
  'email_domain_type', 'ads_segment_id', 'client_id',
  'is_test_user', 'tenants',
  'region_code', 'first_name',
  'settings', 'parent_org_id', 'is_default',
  'is_scale_tier_authorized_purchaser', 'is_scim_managed',
  'banned', 'projects', 'geography',
  'product_features', 'enable_infer', 'enable_infer_opt_out',
  'reasoning_type', 'configurable_thinking_effort',
  'thinking_efforts', 'enabled_tools',
  'secondary_title',
  'current_node_id',
])

function trimResponse(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(trimResponse)
  if (typeof obj === 'object') {
    const out: R = {}
    for (const [k, v] of Object.entries(obj as R)) {
      if (STRIP_KEYS.has(k)) continue
      out[k] = trimResponse(v)
    }
    return out
  }
  return obj
}

async function apiFetch(
  page: Page,
  helpers: AdapterHelpers,
  auth: AuthResult | undefined,
  path: string,
): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (auth?.headers) Object.assign(headers, auth.headers)
  const { text, status } = await helpers.pageFetch(page, {
    url: `${API}${path}`,
    method: 'GET',
    headers,
  })
  if (status === 401 || status === 403) throw helpers.errors.needsLogin()
  if (status < 200 || status >= 300) throw helpers.errors.httpError(status)
  return trimResponse(JSON.parse(text))
}

async function getProfile(
  page: Page, helpers: AdapterHelpers, auth: AuthResult | undefined,
): Promise<unknown> {
  return apiFetch(page, helpers, auth, '/me')
}

async function listConversations(
  page: Page, helpers: AdapterHelpers, auth: AuthResult | undefined,
  params: Readonly<R>,
): Promise<unknown> {
  const qs = new URLSearchParams()
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  if (params.order != null) qs.set('order', String(params.order))
  if (params.is_archived != null) qs.set('is_archived', String(params.is_archived))
  if (params.is_starred != null) qs.set('is_starred', String(params.is_starred))
  if (params.cursor != null) qs.set('cursor', String(params.cursor))
  const q = qs.toString()
  return apiFetch(page, helpers, auth, `/conversations${q ? `?${q}` : ''}`)
}

async function getConversation(
  page: Page, helpers: AdapterHelpers, auth: AuthResult | undefined,
  params: Readonly<R>, errors: AdapterErrorHelpers,
): Promise<unknown> {
  const id = params.conversation_id as string | undefined
  if (!id) throw errors.missingParam('conversation_id')
  return apiFetch(page, helpers, auth, `/conversation/${encodeURIComponent(id)}`)
}

async function searchConversations(
  page: Page, helpers: AdapterHelpers, auth: AuthResult | undefined,
  params: Readonly<R>, errors: AdapterErrorHelpers,
): Promise<unknown> {
  const query = params.query as string | undefined
  if (!query) throw errors.missingParam('query')
  const qs = new URLSearchParams({ query })
  if (params.cursor != null) qs.set('cursor', String(params.cursor))
  return apiFetch(page, helpers, auth, `/conversations/search?${qs}`)
}

async function getModels(
  page: Page, helpers: AdapterHelpers, auth: AuthResult | undefined,
  params: Readonly<R>,
): Promise<unknown> {
  const qs = new URLSearchParams()
  if (params.history_and_training_disabled != null) {
    qs.set('history_and_training_disabled', String(params.history_and_training_disabled))
  }
  const q = qs.toString()
  return apiFetch(page, helpers, auth, `/models${q ? `?${q}` : ''}`)
}

const adapter: CustomRunner = {
  name: 'chatgpt-api',
  description: 'ChatGPT backend API adapter — response trimming for read operations.',

  async run(ctx) {
    const { page, operation, params, helpers, auth } = ctx
    if (!page) throw helpers.errors.fatal('chatgpt-api adapter requires a browser page.')
    switch (operation) {
      case 'getProfile': return getProfile(page, helpers, auth)
      case 'listConversations': return listConversations(page, helpers, auth, params)
      case 'getConversation': return getConversation(page, helpers, auth, params, helpers.errors)
      case 'searchConversations': return searchConversations(page, helpers, auth, params, helpers.errors)
      case 'getModels': return getModels(page, helpers, auth, params)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
