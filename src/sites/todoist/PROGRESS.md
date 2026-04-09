## 2026-04-09: Initial add-site for Todoist

**What changed:**
- Added 4 operations: getProjects, getTasks, createTask, completeTask
- Configured adapter (todoist-api) for bearer token extraction from web app
- Page transport with cookie_session auth

**Why:**
- Todoist REST API v2 is cross-origin (api.todoist.com vs app.todoist.com)
- Bearer token must be intercepted from web app requests
- Adapter pattern matches Spotify/Reuters approach for cross-origin APIs

**Verification:** Pending runtime verify
