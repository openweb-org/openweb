<div align="center">

# OpenWeb

**Agent-native way to access any website.**
**Bridging agent CLI and web GUI through API.**

[![npm version](https://img.shields.io/npm/v/@openweb-org/openweb)](https://www.npmjs.com/package/@openweb-org/openweb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick Start](#quick-start) · [Install](#install) · [Sites](#sites) · [Docs](#documentation) · [Contributing](#development)

</div>

---

Browser automation clicks buttons, reads pixels, and burns tokens. OpenWeb calls the same APIs the website calls.

- **Typed operations** — Every site ships as an OpenAPI spec with typed params, response schemas, and example queries. JSON in, JSON out.
- **Auth primitives** — Cookie sessions, localStorage JWT, CSRF tokens, request signing, multi-step exchange chains, even webpack module walks. 17 primitive types, auto-resolved per request, cached in an encrypted vault.
- **Multi-transport** — Direct HTTP, browser-scoped fetch, WebSocket, or code adapters. The right transport per site, declared in the spec.
- **Security tiers** — Operations classified as read / write / delete / transact. Mutations gated by permission. SSRF protection on every request.
- **Zero token waste** — No screenshots, no vision API, no LLM-powered extraction. Deterministic, pipeable, CI-friendly.
- **50+ sites ready** — From Wikipedia to Instagram, Amazon to Bloomberg. `openweb sites` and go.
- **Add any site** — Record browser traffic, auto-generate the spec, verify. See [Discover & Compile](#discover--compile).

```bash
$ openweb wikipedia getPageSummary '{"title":"World_Wide_Web"}'
{"title":"World Wide Web","extract":"The World Wide Web is a public interconnected information system..."}
```

## Quick Start

```bash
# No install needed — just run
npx @openweb-org/openweb sites
npx @openweb-org/openweb wikipedia getPageSummary '{"title":"World_Wide_Web"}'
```

## Install

### CLI

```bash
npm install -g @openweb-org/openweb

openweb sites                              # list all sites
openweb wikipedia getPageSummary '{"title":"World_Wide_Web"}'
```

### Agent Skill

Pipe this README to your agent (e.g. `claude`, `codex`) and it will self-install:

```bash
curl -fsSL https://raw.githubusercontent.com/openweb-org/openweb/main/README.md | claude
```

Or run the install script directly:

```bash
curl -fsSL https://raw.githubusercontent.com/openweb-org/openweb/main/install-skill.sh | bash
```

Works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [OpenCode](https://opencode.ai), and [OpenClaw](https://github.com/openclaw/openclaw). After install, add to your project instructions (`CLAUDE.md` / `AGENTS.md`):

```markdown
- OpenWeb: Access any website through /openweb
```

See [`skill/openweb/SKILL.md`](skill/openweb/SKILL.md) for what the skill provides.

## Usage

```bash
openweb sites                              # list all sites
openweb <site>                             # site overview + operations
openweb <site> <operation>                 # operation detail + params
openweb <site> <op> '{...}'                # execute
```

For browser-required sites:

```bash
openweb browser start                      # launch managed browser
openweb login <site>                       # authenticate
openweb <site> <op> '{...}'                # execute with auth
```

Full CLI reference: [`skill/openweb/references/cli.md`](skill/openweb/references/cli.md)
Troubleshooting: [`skill/openweb/references/troubleshooting.md`](skill/openweb/references/troubleshooting.md)

## Sites

50+ sites across categories:

| Category | Sites |
|---|---|
| **Social** | instagram, x, reddit, bluesky, linkedin, weibo, xiaohongshu, zhihu |
| **Commerce** | amazon, walmart, target, costco, bestbuy, jd, instacart |
| **Content** | youtube, medium, substack, wikipedia, hackernews, bilibili |
| **Travel** | booking, expedia, google-flights, tripadvisor, ctrip |
| **Finance** | robinhood, fidelity, yahoo-finance, xueqiu, bloomberg |
| **Dev** | github, gitlab, leetcode, chatgpt |
| **Search** | google-search, google-maps |

Run `openweb sites` for the complete list with operation counts and auth requirements.

## How It Works

Each site is a self-contained package:

```
src/sites/<site>/
  manifest.json       # identity, auth, stats
  openapi.yaml        # operations, params, response schemas
  adapters/           # JS transforms for complex sites
  DOC.md              # operator notes
```

The runtime reads the spec → builds the request (URL, headers, auth, CSRF) → dispatches via the right transport (HTTP, browser fetch, SSR, WebSocket) → returns structured JSON.

Auth, CSRF, and transport are declared in the spec via `x-openweb` extensions. Callers never configure them.

## Discover & Compile

Any website can become an OpenWeb site — just ask the agent skill:

```
/openweb Discover and compile the search function on example.com.
```

The agent drives the entire process — you stay in chat to make decisions (confirm auth, approve coverage, handle login). All 50+ built-in sites were created this way.

The agent:

1. **Frames** target intents from a cross-site knowledge base (archetypes, auth patterns, transport expectations)
2. **Captures** browser traffic via CDP (the agent drives the browser, you log in when needed)
3. **Analyzes** traffic — labels, clusters, detects auth/CSRF/signing, finds extraction signals (SSR data, page globals, webpack modules)
4. **Reviews** analysis output — decides if coverage is sufficient or more capture is needed
5. **Curates** the generated spec — edits operation names, merges with existing packages, writes site docs
6. **Verifies** via an independent agent across three dimensions (runtime, spec standards, doc standards)
7. **Learns** — updates the knowledge base with patterns discovered during compilation

See [`skill/openweb/references/discover.md`](skill/openweb/references/discover.md) and [`skill/openweb/references/compile.md`](skill/openweb/references/compile.md).

## Documentation

| | |
|---|---|
| [`doc/main/`](doc/main/) | Architecture, runtime, security |
| [`doc/dev/`](doc/dev/) | Development guides |

## Development

```bash
git clone https://github.com/openweb-org/openweb.git
cd openweb
pnpm install && pnpm build
pnpm test                          # run all tests
pnpm lint                          # biome lint
pnpm --silent dev sites            # dev mode
```

## Disclaimer

OpenWeb is a tool for interacting with websites through their existing interfaces. Users are responsible for complying with each website's terms of service. This project is not affiliated with, endorsed by, or associated with any of the websites listed above.

## License

[MIT](LICENSE)
