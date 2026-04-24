import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://api.github.com'
const HEADERS = { Accept: 'application/vnd.github+json' }

async function fetchJson(url: string, errors: AdapterErrorHelpers): Promise<unknown> {
  const { status, text } = await nodeFetch({ url, method: 'GET', headers: HEADERS, timeout: 20_000 })
  if (status === 404) throw errors.apiError('github', 'Not found')
  if (status === 403 && text.includes('rate limit')) throw errors.retriable('GitHub API rate limit exceeded')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function pickUser(u: Record<string, unknown>): Record<string, unknown> {
  return { login: u.login, avatar_url: u.avatar_url, html_url: u.html_url }
}

function pickLabel(l: Record<string, unknown>): Record<string, unknown> {
  return { name: l.name, color: l.color }
}

function pickRepo(r: Record<string, unknown>): Record<string, unknown> {
  const license = r.license as Record<string, unknown> | null
  return {
    full_name: r.full_name,
    description: r.description,
    html_url: r.html_url,
    language: r.language,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    open_issues_count: r.open_issues_count,
    default_branch: r.default_branch,
    topics: r.topics,
    license: license?.spdx_id ?? null,
    homepage: r.homepage,
    archived: r.archived,
    created_at: r.created_at,
    updated_at: r.updated_at,
    pushed_at: r.pushed_at,
    owner: r.owner ? pickUser(r.owner as Record<string, unknown>) : undefined,
  }
}

async function getRepo(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const owner = params.owner as string | undefined
  const repo = params.repo as string | undefined
  if (!owner || !repo) throw errors.missingParam('owner|repo')
  const data = await fetchJson(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, errors)
  return pickRepo(data as Record<string, unknown>)
}

async function listIssues(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const owner = params.owner as string | undefined
  const repo = params.repo as string | undefined
  if (!owner || !repo) throw errors.missingParam('owner|repo')
  const page = (params.page as number | undefined) ?? 1
  const perPage = (params.per_page as number | undefined) ?? 30
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?page=${page}&per_page=${perPage}`
  const items = (await fetchJson(url, errors)) as Array<Record<string, unknown>>
  return items.map(i => ({
    number: i.number,
    title: i.title,
    state: i.state,
    user: i.user ? pickUser(i.user as Record<string, unknown>) : null,
    labels: ((i.labels as Array<Record<string, unknown>>) ?? []).map(pickLabel),
    created_at: i.created_at,
    updated_at: i.updated_at,
    comments: i.comments,
    html_url: i.html_url,
    pull_request: i.pull_request ? true : undefined,
  }))
}

async function searchRepos(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const q = params.q as string | undefined
  if (!q) throw errors.missingParam('q')
  const sort = params.sort as string | undefined
  const order = (params.order as string | undefined) ?? 'desc'
  const perPage = (params.per_page as number | undefined) ?? 30
  const page = (params.page as number | undefined) ?? 1
  let url = `${API}/search/repositories?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&order=${order}`
  if (sort) url += `&sort=${encodeURIComponent(sort)}`
  const data = (await fetchJson(url, errors)) as Record<string, unknown>
  const items = (data.items as Array<Record<string, unknown>>) ?? []
  return {
    total_count: data.total_count,
    items: items.map(r => ({
      full_name: r.full_name,
      description: r.description,
      language: r.language,
      stargazers_count: r.stargazers_count,
      forks_count: r.forks_count,
      open_issues_count: r.open_issues_count,
      topics: r.topics,
      license: (r.license as Record<string, unknown> | null)?.spdx_id ?? null,
      updated_at: r.updated_at,
      html_url: r.html_url,
    })),
  }
}

async function getUserProfile(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const username = params.username as string | undefined
  if (!username) throw errors.missingParam('username')
  const data = (await fetchJson(`${API}/users/${encodeURIComponent(username)}`, errors)) as Record<string, unknown>
  return {
    login: data.login,
    name: data.name,
    bio: data.bio,
    company: data.company,
    location: data.location,
    blog: data.blog,
    html_url: data.html_url,
    public_repos: data.public_repos,
    public_gists: data.public_gists,
    followers: data.followers,
    following: data.following,
    created_at: data.created_at,
    twitter_username: data.twitter_username,
  }
}

async function getRepoReadme(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const owner = params.owner as string | undefined
  const repo = params.repo as string | undefined
  if (!owner || !repo) throw errors.missingParam('owner|repo')
  const data = (await fetchJson(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, errors)) as Record<string, unknown>
  const raw = data.content as string | undefined
  let content = raw ?? ''
  if (data.encoding === 'base64' && raw) {
    content = Buffer.from(raw.replace(/\n/g, ''), 'base64').toString('utf-8')
  }
  return { name: data.name, path: data.path, content, html_url: data.html_url }
}

async function listPullRequests(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const owner = params.owner as string | undefined
  const repo = params.repo as string | undefined
  if (!owner || !repo) throw errors.missingParam('owner|repo')
  const state = (params.state as string | undefined) ?? 'open'
  const page = (params.page as number | undefined) ?? 1
  const perPage = (params.per_page as number | undefined) ?? 30
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&page=${page}&per_page=${perPage}`
  const items = (await fetchJson(url, errors)) as Array<Record<string, unknown>>
  return items.map(pr => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    user: pr.user ? pickUser(pr.user as Record<string, unknown>) : null,
    head: pr.head ? { ref: (pr.head as Record<string, unknown>).ref, label: (pr.head as Record<string, unknown>).label } : null,
    base: pr.base ? { ref: (pr.base as Record<string, unknown>).ref, label: (pr.base as Record<string, unknown>).label } : null,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at,
    html_url: pr.html_url,
  }))
}

async function listContributors(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const owner = params.owner as string | undefined
  const repo = params.repo as string | undefined
  if (!owner || !repo) throw errors.missingParam('owner|repo')
  const perPage = (params.per_page as number | undefined) ?? 30
  const page = (params.page as number | undefined) ?? 1
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=${perPage}&page=${page}`
  const items = (await fetchJson(url, errors)) as Array<Record<string, unknown>>
  return items.map(c => ({
    login: c.login,
    contributions: c.contributions,
    avatar_url: c.avatar_url,
    html_url: c.html_url,
  }))
}

const OPERATIONS: Record<string, (params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers) => Promise<unknown>> = {
  getRepo, listIssues, searchRepos, getUserProfile, getRepoReadme, listPullRequests, listContributors,
}

const adapter: CustomRunner = {
  name: 'github-read',
  description: 'GitHub — response trimming for read operations, base64→text README decode',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
