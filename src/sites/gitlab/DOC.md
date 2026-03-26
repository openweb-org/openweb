# GitLab

## Overview
GitLab REST API v4 — code hosting and DevOps platform.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProjects | search projects | GET /api/v4/projects | `search`, `order_by` params |
| getProject | get project by ID | GET /api/v4/projects/{projectId} | accepts ID or URL-encoded path |
| listProjectIssues | list project issues | GET /api/v4/projects/{projectId}/issues | filter by `state` |
| listProjectMergeRequests | list project MRs | GET /api/v4/projects/{projectId}/merge_requests | filter by `state` |
| listProjectPipelines | list project pipelines | GET /api/v4/projects/{projectId}/pipelines | |
| listProjectBranches | list branches | GET /api/v4/projects/{projectId}/repository/branches | `search` filter |
| getProjectFile | get file metadata | GET /api/v4/projects/{projectId}/repository/files/{filePath} | base64-encoded content, requires `ref` |
| getProjectFileRaw | get raw file content | GET /api/v4/projects/{projectId}/repository/files/{filePath}/raw | plain text, requires `ref` |
| searchUsers | search users | GET /api/v4/users | filter by `username` or `search` |
| starProject | star a project | POST /api/v4/projects/{projectId}/star | requires auth, ✅ SAFE |
| unstarProject | unstar a project | POST /api/v4/projects/{projectId}/unstar | requires auth, ✅ SAFE |
| searchGroups | search groups | GET /api/v4/groups | |
| getGroup | get group by ID | GET /api/v4/groups/{groupId} | accepts ID or URL-encoded path |

## API Architecture
- Standard REST v4 at `gitlab.com/api/v4/`
- All list endpoints use `link_header` pagination with `per_page` (max 100) and `page` params
- `projectId` and `groupId` accept either numeric IDs or URL-encoded namespace paths
- `filePath` must be URL-encoded (e.g. `README%2Emd` for `README.md`)

## Auth
- `cookie_session` — uses browser session cookies
- CSRF: `meta_tag` type, reads `csrf-token` meta tag, sends as `X-CSRF-Token` header on mutating requests (PUT/POST/PATCH/DELETE)

## Transport
- `node` — all endpoints use direct HTTP, no browser page needed

## Known Issues
- None observed
