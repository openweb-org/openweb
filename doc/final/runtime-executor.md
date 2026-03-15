# Runtime Executor v2

> Evolved from v1 (see `archive/v1/` for CLI design, session lifecycle, error contract).
> Adds L2 primitive execution and L3 adapter execution.

## TODO

Carry forward v1 CLI design (progressive disclosure, exec command) and add:

### L2 Primitive Execution
- Before making HTTP request, run L2 primitives to extract dynamic values
- Auth primitive → extract token from storage/global → inject into request
- CSRF primitive → extract fresh token → inject into header/body
- Signing primitive → compute signature → inject into Authorization header
- Define the primitive execution order and dependency resolution

### L3 Adapter Execution
- Always runs in browser page context (`page.evaluate()`)
- Adapter receives params, returns structured output
- Can call L2 primitives for auth/CSRF extraction
- Define adapter lifecycle (load, execute, cleanup)

### Execution Mode Selection
- L1 endpoints: direct_http → session_http → browser_fetch (v1 escalation)
- L2 endpoints: depends on primitive requirements
  - `auth.localStorage_jwt` → needs browser for extraction, then direct_http for request
  - `signing.sapisidhash` → needs browser (crypto.subtle + cookie)
  - `csrf.cookie_to_header` → session_http sufficient
- L3 endpoints: always browser_fetch

### Unchanged from v1
- CLI commands (sites, show, exec)
- Error contract (JSON stderr)
- SSRF protection
- Self-healing
- Session lifecycle
