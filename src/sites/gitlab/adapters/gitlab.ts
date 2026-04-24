import { nodeFetch } from '../../../lib/adapter-helpers.js'
import { formatCookieString } from '../../../lib/cookies.js'
import { readTokenCache } from '../../../runtime/token-cache.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://gitlab.com/api/v4'

type Params = Readonly<Record<string, unknown>>
type Item = Record<string, unknown>

async function authHeaders(): Promise<Record<string, string>> {
  const cached = await readTokenCache('gitlab').catch(() => null)
  if (!cached || cached.cookies.length === 0) return {}
  const cookieStr = formatCookieString(cached.cookies)
  return cookieStr ? { Cookie: cookieStr } : {}
}

async function fetchJson(url: string, errors: AdapterErrorHelpers): Promise<unknown> {
  const auth = await authHeaders()
  const { status, text } = await nodeFetch({
    url, method: 'GET',
    headers: { Accept: 'application/json', ...auth },
    timeout: 20_000,
  })
  if (status === 401 || status === 403) throw errors.needsLogin()
  if (status === 404) throw errors.apiError('gitlab', 'Not found')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

async function fetchJsonNoAuth(url: string, errors: AdapterErrorHelpers): Promise<unknown> {
  const { status, text } = await nodeFetch({
    url, method: 'GET',
    headers: { Accept: 'application/json' },
    timeout: 20_000,
  })
  if (status === 404) throw errors.apiError('gitlab', 'Not found')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(base: string, params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `${base}?${parts.join('&')}` : base
}

function int(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function trimProject(p: Item): Item {
  return {
    id: p.id,
    name: p.name,
    path_with_namespace: p.path_with_namespace,
    description: p.description ?? null,
    web_url: p.web_url,
    star_count: p.star_count,
    forks_count: p.forks_count,
    default_branch: p.default_branch ?? null,
    visibility: p.visibility,
    open_issues_count: p.open_issues_count,
    last_activity_at: p.last_activity_at,
  }
}

function trimProjectDetail(p: Item): Item {
  return {
    ...trimProject(p),
    name_with_namespace: p.name_with_namespace,
    created_at: p.created_at,
  }
}

function trimIssue(i: Item): Item {
  const author = i.author as Item | undefined
  return {
    id: i.id,
    iid: i.iid,
    title: i.title,
    state: i.state,
    description: i.description ?? null,
    web_url: i.web_url,
    labels: i.labels,
    author: author ? { username: author.username, name: author.name } : null,
    created_at: i.created_at,
    updated_at: i.updated_at,
  }
}

function trimMR(mr: Item): Item {
  const author = mr.author as Item | undefined
  const reviewers = mr.reviewers as Item[] | undefined
  return {
    id: mr.id,
    iid: mr.iid,
    title: mr.title,
    state: mr.state,
    description: mr.description ?? null,
    web_url: mr.web_url,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    author: author ? { username: author.username, name: author.name } : null,
    reviewers: reviewers?.map(r => ({ username: r.username, name: r.name })) ?? [],
    draft: mr.draft,
    has_conflicts: mr.has_conflicts,
    labels: mr.labels,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
  }
}

function trimPipeline(p: Item): Item {
  return {
    id: p.id,
    iid: p.iid,
    project_id: p.project_id,
    status: p.status,
    ref: p.ref,
    sha: p.sha,
    source: p.source,
    web_url: p.web_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

function trimBranch(b: Item): Item {
  const commit = b.commit as Item | undefined
  return {
    name: b.name,
    merged: b.merged,
    protected: b.protected,
    default: b.default,
    web_url: b.web_url,
    commit_short_id: commit?.short_id ?? null,
    commit_title: commit?.title ?? null,
  }
}

function trimGroup(g: Item): Item {
  return {
    id: g.id,
    name: g.name,
    path: g.path,
    description: g.description ?? null,
    web_url: g.web_url,
    visibility: g.visibility,
    full_path: g.full_path,
  }
}

function trimUser(u: Item): Item {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    state: u.state,
    avatar_url: u.avatar_url,
    web_url: u.web_url,
  }
}

function trimFile(f: Item): Item {
  return {
    file_name: f.file_name,
    file_path: f.file_path,
    size: f.size,
    encoding: f.encoding,
    ref: f.ref,
    last_commit_id: f.last_commit_id,
    content: f.content,
  }
}

function pid(params: Params, errors: AdapterErrorHelpers): number {
  const v = params.projectId as number | undefined
  if (!v) throw errors.missingParam('projectId')
  return v
}

// ── Operations ──────────────────────────────────────────────────────────

async function searchProjects(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/projects`, {
    search: str(params.search),
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
    order_by: str(params.order_by) ?? 'created_at',
    simple: 'true',
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimProject)
}

async function getProject(params: Params, errors: AdapterErrorHelpers) {
  const id = pid(params, errors)
  const raw = await fetchJson(`${API}/projects/${id}`, errors) as Item
  return trimProjectDetail(raw)
}

async function listProjectIssues(params: Params, errors: AdapterErrorHelpers) {
  const id = pid(params, errors)
  const url = qs(`${API}/projects/${id}/issues`, {
    state: str(params.state) ?? 'opened',
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimIssue)
}

async function listProjectMergeRequests(params: Params, errors: AdapterErrorHelpers) {
  const id = pid(params, errors)
  const url = qs(`${API}/projects/${id}/merge_requests`, {
    state: str(params.state) ?? 'opened',
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimMR)
}

async function listProjectPipelines(params: Params, errors: AdapterErrorHelpers) {
  const id = pid(params, errors)
  const url = qs(`${API}/projects/${id}/pipelines`, {
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
    status: str(params.status),
    ref: str(params.ref),
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimPipeline)
}

async function listProjectBranches(params: Params, errors: AdapterErrorHelpers) {
  const id = pid(params, errors)
  const url = qs(`${API}/projects/${id}/repository/branches`, {
    search: str(params.search),
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimBranch)
}

async function getProjectFile(params: Params, errors: AdapterErrorHelpers) {
  const id = pid(params, errors)
  const filePath = params.filePath as string | undefined
  if (!filePath) throw errors.missingParam('filePath')
  const ref = params.ref as string | undefined
  if (!ref) throw errors.missingParam('ref')
  const encoded = encodeURIComponent(filePath)
  const url = qs(`${API}/projects/${id}/repository/files/${encoded}`, { ref })
  const raw = await fetchJson(url, errors) as Item
  return trimFile(raw)
}

async function searchUsers(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/users`, {
    username: str(params.username),
    search: str(params.search),
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimUser)
}

async function searchGroups(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/groups`, {
    search: str(params.search),
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
    order_by: str(params.order_by) ?? 'similarity',
  })
  const raw = await fetchJsonNoAuth(url, errors) as Item[]
  return raw.map(trimGroup)
}

async function getGroup(params: Params, errors: AdapterErrorHelpers) {
  const groupId = params.groupId as number | undefined
  if (!groupId) throw errors.missingParam('groupId')
  const url = qs(`${API}/groups/${groupId}`, { with_projects: 'false' })
  const raw = await fetchJson(url, errors) as Item
  return trimGroup(raw)
}

async function listGroupProjects(params: Params, errors: AdapterErrorHelpers) {
  const groupId = params.groupId as number | undefined
  if (!groupId) throw errors.missingParam('groupId')
  const url = qs(`${API}/groups/${groupId}/projects`, {
    per_page: int(params.per_page, 20),
    page: int(params.page, 1),
    simple: 'true',
  })
  const raw = await fetchJson(url, errors) as Item[]
  return raw.map(trimProject)
}

const OPERATIONS: Record<string, (p: Params, e: AdapterErrorHelpers) => Promise<unknown>> = {
  searchProjects, getProject, listProjectIssues, listProjectMergeRequests,
  listProjectPipelines, listProjectBranches, getProjectFile, searchUsers,
  searchGroups, getGroup, listGroupProjects,
}

const adapter: CustomRunner = {
  name: 'gitlab',
  description: 'GitLab — response trimming, simple mode for project lists, pipeline status filter',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
