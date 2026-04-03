# OpenWeb

Let any agent access the web -- typed site APIs, auth primitives, one CLI.

OpenWeb turns websites into callable operations. Each site ships as a package with an OpenAPI spec, auth/transport config, and optional adapters. The CLI handles cookies, CSRF, signing, browser sessions, and response extraction so callers get structured JSON.

## Quick Start

```bash
npm install -g @openweb-org/openweb

openweb sites                          # list all available sites
openweb wikipedia exec getPageSummary '{"title":"Claude_Shannon"}'
```

## Usage

### List available sites

```bash
openweb sites
```

Shows every site the CLI can resolve, with operation counts and auth requirements.

### View a site and its operations

```bash
openweb wikipedia                      # site overview: URL, auth, transport, operations
openweb wikipedia getPageSummary       # operation detail: params, response schema
openweb wikipedia getPageSummary --example   # example input from fixtures
```

### Execute an operation

```bash
openweb wikipedia exec getPageSummary '{"title":"Claude_Shannon"}'
openweb hackernews exec getTopStories '{}'
```

Successful output goes to stdout as JSON. Errors go to stderr as structured JSON with a `failureClass` field (see [Troubleshooting](#troubleshooting)).

Responses over 4096 bytes automatically spill to a temp file; the path is printed to stdout.

Enable debug output with `OPENWEB_DEBUG=1`:

```bash
OPENWEB_DEBUG=1 openweb wikipedia exec getPageSummary '{"title":"Claude_Shannon"}'
```

### Browser-required sites (login flow)

Some sites require a real browser session for authentication. Browser support is separate from the default install.

```bash
# 1. Install Playwright browsers (one-time)
npx playwright install chromium

# 2. Start a managed browser (copies your Chrome profile for auth)
openweb browser start              # headed (you can see the browser)
openweb browser start --headless   # headless

# 3. Log in if needed
openweb login instagram            # opens login page, waits for you to complete

# 4. Execute authenticated operations
openweb instagram exec getFeed '{}'

# Other browser commands
openweb browser status             # check if browser is running
openweb browser restart            # re-copy profile, clear token cache
openweb browser stop               # shut down and clean up
```

`openweb <site>` shows whether a site requires a browser and/or login.

### Local editing

```bash
openweb init                       # copy site packages to ~/.openweb/sites/
```

This creates editable local copies. The CLI resolves sites in this order:

1. `$OPENWEB_HOME/sites/<site>` (local edits -- `openweb init` writes here)
2. `$OPENWEB_HOME/registry/<site>/<current>` (registry installs)
3. Bundled `dist/sites/<site>` (shipped with the package)
4. Repo `src/sites/<site>` (development mode)

Set `OPENWEB_HOME` to override the default `~/.openweb` data directory.

## How It Works

```
src/sites/<site>/
  manifest.json       # identity, auth requirement, stats
  openapi.yaml        # operations, params, response schemas, x-openweb extensions
  asyncapi.yaml       # WebSocket operations (if applicable)
  adapters/           # JS transform layers for complex sites
  DOC.md              # operator notes, workflows, known issues
  examples/           # fixture files for --example and verify
```

The runtime reads the spec, builds the request (URL, headers, body, auth tokens, CSRF tokens), executes it via the appropriate transport (direct HTTP, session HTTP, browser fetch, server-side rendering, or WebSocket), and parses the response.

Transport and auth are declared in the spec via `x-openweb` extensions -- callers never configure them manually.

## For AI Agents

OpenWeb ships as a Claude Code skill at `skill/openweb/SKILL.md`. Add the skill to your project and the agent can access any site through the `/openweb` command.

The skill routes by intent:

- **Use a site** -- `openweb sites`, then `openweb <site> exec <op> '{...}'`
- **Add a new site** -- discover flow (capture traffic, compile spec)
- **Diagnose failures** -- troubleshooting references

Agents receive structured JSON on stdout and structured errors on stderr. The `failureClass` field in errors tells the agent exactly what to do next (start browser, log in, retry, or stop).

## Troubleshooting

Errors are JSON on stderr with a `failureClass` field. Handle by class:

| failureClass | Meaning | What to do |
|---|---|---|
| `needs_browser` | Operation requires a browser session | `openweb browser start` |
| `needs_login` | Auth token missing or expired (401/403) | `openweb login <site>`, then `openweb browser restart` |
| `needs_page` | Operation requires navigating to the site | Open a browser tab to the site URL |
| `permission_denied` | Operation blocked by permission config | Edit `~/.openweb/permissions.yaml` |
| `permission_required` | Write/delete/transact needs confirmation | Confirm and retry |
| `retriable` | Transient failure (429, 5xx) | Wait a few seconds, retry (max 2 attempts) |
| `fatal` | Bad params, unknown site/operation | Fix the request -- do not retry |

Common scenarios:

**"No browser connection"** -- Run `openweb browser start`. If already running, try `openweb browser restart`.

**"401 Unauthorized" on a site that worked before** -- Auth tokens expired. Run `openweb login <site>` then `openweb browser restart` to re-copy the profile and clear the token cache.

**Empty or HTML response** -- The site may need a different transport. Check `openweb <site>` for transport requirements.

## Development

```bash
git clone https://github.com/openweb-org/openweb.git
cd openweb
pnpm install && pnpm build
pnpm test                          # run all tests
pnpm lint                          # biome lint
pnpm --silent dev sites            # dev mode (reads src/sites/)
pnpm --silent dev wikipedia exec getPageSummary '{"title":"Claude_Shannon"}'
```

## License

[MIT](LICENSE)
