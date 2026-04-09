# Todoist

## Overview
Task management platform — productivity/personal-organization archetype.

## Workflows

### List projects and browse tasks
1. `getProjects()` → id, name, is_inbox_project
2. `getTasks(project_id)` → id, content, due, priority, labels

### Create a task
1. `getProjects()` → id (pick target project)
2. `createTask(content, project_id, due_string, priority)` → id, content, due

### Complete a task
1. `getTasks(project_id)` → id, content
2. `completeTask(task_id)` → success

### Filter tasks by due date or priority
1. `getTasks(filter: "today")` → tasks due today
2. `getTasks(filter: "priority 1")` → urgent tasks

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProjects | list all projects | — | id, name, color, is_inbox_project | entry point for project IDs |
| getTasks | tasks in a project | project_id ← getProjects | content, due, priority, labels | supports filter expressions |
| createTask | create a new task | content, project_id ← getProjects | id, content, due, url | write op |
| completeTask | mark task done | task_id ← getTasks | success | write op, irreversible for non-recurring |

## Quick Start

```bash
# List all projects
openweb todoist exec getProjects '{}'

# Get tasks in a project
openweb todoist exec getTasks '{"project_id":"2203306141"}'

# Get today's tasks
openweb todoist exec getTasks '{"filter":"today"}'

# Create a task
openweb todoist exec createTask '{"content":"Buy groceries","due_string":"tomorrow","priority":2}'

# Complete a task
openweb todoist exec completeTask '{"task_id":"7025654312"}'
```

---

## Site Internals

## API Architecture
- Public REST API v2 at `api.todoist.com/rest/v2/`
- Standard CRUD endpoints: GET/POST with JSON bodies
- Cross-origin: web app at `app.todoist.com`, API at `api.todoist.com`

## Auth
- Bearer token in Authorization header for all API calls
- Token extracted from web app's API requests via request interception
- Token is long-lived but may expire; adapter retries with fresh token on 401/403

## Transport
- Adapter (`todoist-api`) — required because:
  1. Cross-origin API (different domain from web app)
  2. Bearer token must be extracted from web app runtime
- Page transport with cookie_session at server level

## Known Issues
- **Login required:** All operations require an authenticated Todoist session
- **completeTask on recurring tasks:** Completes only the current occurrence, not the task itself
- **Rate limiting:** Todoist API limits to ~450 requests per 15 minutes
