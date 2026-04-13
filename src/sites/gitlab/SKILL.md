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

### File an issue and discuss
1. `searchProjects(search)` → `projectId`
2. `createIssue(projectId, title, description)` → new issue → `iid`
3. `createComment(projectId, issueIid, body)` → add discussion
4. `closeIssue(projectId, issueIid)` → close when resolved
5. `deleteComment(projectId, issueIid, noteId)` → remove a comment

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
| createIssue | create issue | projectId ← searchProjects, title, description | iid, title, state, web_url | write, CAUTION |
| closeIssue | close issue | projectId ← searchProjects, issueIid ← listProjectIssues | iid, title, state | write, CAUTION |
| createComment | comment on issue | projectId, issueIid ← listProjectIssues, body | id, body, author | write, CAUTION |
| deleteComment | delete comment | projectId, issueIid, noteId ← createComment | (no content) | write, CAUTION |

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

# Create an issue
openweb gitlab exec createIssue '{"projectId": 81206763, "title": "Bug report", "description": "Steps to reproduce..."}'

# Close an issue
openweb gitlab exec closeIssue '{"projectId": 81206763, "issueIid": 1}'

# Comment on an issue
openweb gitlab exec createComment '{"projectId": 81206763, "issueIid": 1, "body": "Confirmed on my end"}'

# Delete a comment
openweb gitlab exec deleteComment '{"projectId": 81206763, "issueIid": 1, "noteId": 12345}'
```
