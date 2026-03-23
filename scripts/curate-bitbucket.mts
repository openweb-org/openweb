import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'

const inputPath = process.argv[2] || `${process.env.HOME}/.openweb/sites/bitbucket/openapi.yaml`
const outputPath = process.argv[3] || inputPath

const doc = parse(readFileSync(inputPath, 'utf8'))

const pathRewrites: Record<string, string> = {
  '/2.0/repositories': '/2.0/repositories',
  '/2.0/repositories/atlassian': '/2.0/repositories/{workspace}',
  '/2.0/repositories/atlassian/aui': '/2.0/repositories/{workspace}/{repo_slug}',
  '/2.0/repositories/atlassian/aui/commits': '/2.0/repositories/{workspace}/{repo_slug}/commits',
  '/2.0/repositories/atlassian/aui/pullrequests': '/2.0/repositories/{workspace}/{repo_slug}/pullrequests',
  '/2.0/repositories/atlassian/aui/refs/branches': '/2.0/repositories/{workspace}/{repo_slug}/refs/branches',
}

const renames: Record<string, { id: string; summary: string }> = {
  'list_2.0_repositories': { id: 'listPublicRepositories', summary: 'List public repositories' },
  'get_2.0_repositories_atlassian': { id: 'listWorkspaceRepositories', summary: 'List repositories in a workspace' },
  'get_2.0_repositories_atlassian_aui': { id: 'getRepository', summary: 'Get repository details' },
  'list_2.0_repositories_atlassian_aui_commits': { id: 'listRepositoryCommits', summary: 'List repository commits' },
  'list_2.0_repositories_atlassian_aui_pullrequests': { id: 'listPullRequests', summary: 'List pull requests' },
  'list_2.0_repositories_atlassian_aui_refs_branches': { id: 'listBranches', summary: 'List repository branches' },
}

const workspaceParam = {
  name: 'workspace',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'The workspace slug or UUID.',
}
const repoSlugParam = {
  name: 'repo_slug',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'The repository slug.',
}

const newPaths: Record<string, unknown> = {}

// Track which src path to skip (has commit hash — not useful as parameterized endpoint)
const skipPaths = new Set<string>()
for (const path of Object.keys(doc.paths)) {
  if (path.includes('/src/')) skipPaths.add(path)
}

for (const [path, ops] of Object.entries(doc.paths) as [string, Record<string, any>][]) {
  if (skipPaths.has(path)) continue

  const newPath = pathRewrites[path] ?? path

  for (const [, op] of Object.entries(ops)) {
    if (!op?.operationId) continue

    const rename = renames[op.operationId]
    if (rename) {
      op.operationId = rename.id
      op.summary = rename.summary
    }

    // Fix optional params
    if (op.parameters) {
      for (const param of op.parameters) {
        if (param.name === 'pagelen') {
          param.required = false
          param.description = 'Number of results per page (max 100).'
        }
        if (param.name === 'q') {
          param.required = false
          param.description = 'Query filter (e.g., language="python").'
        }
        if (param.name === 'state') {
          param.required = false
          param.description = 'Filter by state: OPEN, MERGED, DECLINED, SUPERSEDED.'
        }
      }
    }

    // Add path parameters
    op.parameters = op.parameters ?? []
    if (newPath.includes('{workspace}') && !op.parameters.some((p: any) => p.name === 'workspace')) {
      op.parameters.unshift(workspaceParam)
    }
    if (newPath.includes('{repo_slug}') && !op.parameters.some((p: any) => p.name === 'repo_slug')) {
      const idx = op.parameters.findIndex((p: any) => p.name === 'workspace')
      op.parameters.splice(idx + 1, 0, repoSlugParam)
    }
  }

  newPaths[newPath] = ops
}

doc.paths = newPaths

writeFileSync(outputPath, stringify(doc, { lineWidth: 120 }))
console.log(`Curated: ${Object.keys(newPaths).length} paths`)
