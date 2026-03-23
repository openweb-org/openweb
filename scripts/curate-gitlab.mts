import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'

const inputPath = process.argv[2] || `${process.env.HOME}/.openweb/sites/gitlab/openapi.yaml`
const outputPath = process.argv[3] || inputPath

const doc = parse(readFileSync(inputPath, 'utf8'))

// Parameterize hardcoded IDs: project 278964 → {projectId}, group 9970 → {groupId}
const pathRewrites: Record<string, string> = {
  '/api/v4/groups/9970': '/api/v4/groups/{groupId}',
  '/api/v4/projects/278964': '/api/v4/projects/{projectId}',
  '/api/v4/projects/278964/issues': '/api/v4/projects/{projectId}/issues',
  '/api/v4/projects/278964/merge_requests': '/api/v4/projects/{projectId}/merge_requests',
  '/api/v4/projects/278964/pipelines': '/api/v4/projects/{projectId}/pipelines',
  '/api/v4/projects/278964/repository/branches': '/api/v4/projects/{projectId}/repository/branches',
}

const renames: Record<string, { id: string; summary: string }> = {
  'list_groups': { id: 'searchGroups', summary: 'Search groups by name' },
  'get_groups_9970': { id: 'getGroup', summary: 'Get group by ID' },
  'list_projects': { id: 'searchProjects', summary: 'Search projects' },
  'get_projects_278964': { id: 'getProject', summary: 'Get project by ID' },
  'list_projects_278964_issues': { id: 'listProjectIssues', summary: 'List project issues' },
  'list_projects_278964_merge_requests': { id: 'listProjectMergeRequests', summary: 'List project merge requests' },
  'list_projects_278964_pipelines': { id: 'listProjectPipelines', summary: 'List project pipelines' },
  'list_projects_278964_repository_branches': { id: 'listProjectBranches', summary: 'List project repository branches' },
}

// Path parameter definitions
const projectIdParam = {
  name: 'projectId',
  in: 'path',
  required: true,
  schema: { type: 'integer' },
  description: 'The ID or URL-encoded path of the project.',
}
const groupIdParam = {
  name: 'groupId',
  in: 'path',
  required: true,
  schema: { type: 'integer' },
  description: 'The ID or URL-encoded path of the group.',
}

const newPaths: Record<string, unknown> = {}

for (const [path, ops] of Object.entries(doc.paths) as [string, Record<string, any>][]) {
  const newPath = pathRewrites[path] ?? path

  for (const [method, op] of Object.entries(ops)) {
    if (!op?.operationId) continue

    // Rename operation
    const rename = renames[op.operationId]
    if (rename) {
      op.operationId = rename.id
      op.summary = rename.summary
    }

    // Fix: make search optional on list/search endpoints
    if (op.parameters) {
      for (const param of op.parameters) {
        if (param.name === 'search') {
          param.required = false
          param.description = 'Search query string.'
        }
        if (param.name === 'per_page') {
          param.required = false
          param.description = 'Number of results per page (max 100).'
        }
        if (param.name === 'state') {
          param.required = false
          param.description = 'Filter by state: opened, closed, merged, all.'
        }
      }
    }

    // Add path parameters for parameterized paths
    if (newPath.includes('{projectId}')) {
      op.parameters = op.parameters ?? []
      if (!op.parameters.some((p: any) => p.name === 'projectId')) {
        op.parameters.unshift(projectIdParam)
      }
    }
    if (newPath.includes('{groupId}')) {
      op.parameters = op.parameters ?? []
      if (!op.parameters.some((p: any) => p.name === 'groupId')) {
        op.parameters.unshift(groupIdParam)
      }
    }
  }

  newPaths[newPath] = ops
}

doc.paths = newPaths
doc.info.title = 'gitlab'

writeFileSync(outputPath, stringify(doc, { lineWidth: 120 }))
const opCount = Object.values(newPaths).reduce(
  (n, ops: any) => n + Object.keys(ops).filter((k) => k !== 'parameters').length,
  0,
)
console.log(`Curated: ${Object.keys(newPaths).length} paths, ${opCount} operations`)
