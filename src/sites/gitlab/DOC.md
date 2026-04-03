# GitLab

## Overview
GitLab REST API v4 — code hosting and DevOps platform (developer tools archetype).

## Workflows

### Explore a project's CI/CD status
1. `searchProjects(search)` → pick project → `projectId`
2. `getProject(projectId)` → confirm project details
3. `listProjectPipelines(projectId)` → pipeline statuses
4. `listProjectBranches(projectId)` → active branches

### Review project issues and merge requests
1. `searchProjects(search)` → `projectId`
2. `listProjectIssues(projectId, state)` → open/closed issues
3. `listProjectMergeRequests(projectId, state)` → open/merged MRs

### Browse group projects
1. `searchGroups(search)` → pick group → `groupId`
2. `getGroup(groupId)` → group details
3. `listGroupProjects(groupId)` → projects in the group → `projectId`
4. `getProject(projectId)` → full project detail

### Read a file from a repository
1. `searchProjects(search)` → `projectId`
2. `listProjectBranches(projectId)` → pick branch → `ref`
3. `getProjectFile(projectId, filePath, ref)` → base64 content + metadata

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProjects | search projects | search, order_by | id, name, path_with_namespace, star_count | entry point |
| getProject | project detail | projectId ← searchProjects | name, description, star_count, forks_count, default_branch | |
| listProjectIssues | list issues | projectId ← searchProjects, state | iid, title, state, labels | paginated |
| listProjectMergeRequests | list MRs | projectId ← searchProjects, state | iid, title, state, source_branch, target_branch | paginated |
| listProjectPipelines | list pipelines | projectId ← searchProjects | id, status, ref, sha | paginated |
| listProjectBranches | list branches | projectId ← searchProjects, search | name, merged, protected, default | paginated |
| getProjectFile | file metadata + content | projectId ← searchProjects, filePath, ref ← listProjectBranches | file_name, size, content (base64) | |
| searchUsers | search users | search or username | id, username, name, state | entry point |
| starProject | star a project | projectId ← searchProjects | star_count | write, SAFE |
| unstarProject | unstar a project | projectId ← searchProjects | star_count | write, SAFE |
| searchGroups | search groups | search | id, name, path, visibility | entry point |
| getGroup | group detail | groupId ← searchGroups | name, description, visibility, full_path | |
| listGroupProjects | group's projects | groupId ← searchGroups | id, name, path_with_namespace, star_count | paginated |

## Quick Start

```bash
# Search projects
openweb gitlab exec searchProjects '{"search": "kubernetes", "per_page": 5}'

# Get project detail
openweb gitlab exec getProject '{"projectId": 278964}'

# List open issues for a project
openweb gitlab exec listProjectIssues '{"projectId": 278964, "state": "opened", "per_page": 10}'

# List merge requests
openweb gitlab exec listProjectMergeRequests '{"projectId": 278964, "state": "merged", "per_page": 5}'

# List CI/CD pipelines
openweb gitlab exec listProjectPipelines '{"projectId": 278964, "per_page": 5}'

# Search users
openweb gitlab exec searchUsers '{"search": "gitlab-bot", "per_page": 5}'

# Get group detail and list their projects
openweb gitlab exec getGroup '{"groupId": 9970}'
openweb gitlab exec listGroupProjects '{"groupId": 9970, "per_page": 5}'

# Get a file from a repository (returns base64 content)
openweb gitlab exec getProjectFile '{"projectId": 278964, "filePath": "README.md", "ref": "master"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture
- Standard REST v4 at `gitlab.com/api/v4/`
- All list endpoints use `link_header` pagination with `per_page` (max 100) and `page` params
- `projectId` and `groupId` accept either numeric IDs or URL-encoded namespace paths (e.g. `gitlab-org%2Fgitlab`)
- `filePath` must be URL-encoded (e.g. `README%2Emd` for `README.md`)

## Auth
- `cookie_session` — uses browser session cookies
- CSRF: `meta_tag` type, reads `csrf-token` meta tag from page DOM, sends as `X-CSRF-Token` header on mutating requests (POST/PUT/PATCH/DELETE)
- Cookies are extracted from the browser automatically

## Transport
- `node` — all endpoints use direct HTTP; cookies extracted from browser automatically when needed for auth

## Known Issues
- Write operations (starProject, unstarProject) require an active login session
- `searchGroups` search parameter returns empty results without authentication; use `getGroup` with a known `groupId` instead
- File path parameter must be URL-encoded (slashes become `%2F`, dots become `%2E`)
- `getProjectFileRaw` removed — runtime does not support text/plain responses; use `getProjectFile` (returns base64 content) instead
