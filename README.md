<div align="center">

# OpenWeb

**Agent-native way to access any website.**
**Bridging agent CLI and web GUI through API.**

[![npm version](https://img.shields.io/npm/v/@openweb-org/openweb)](https://www.npmjs.com/package/@openweb-org/openweb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick Start](#quick-start) · [Install](#install) · [How It Works](#how-it-works) · [Discover & Compile](#discover--compile) · [Sites](#sites) · [Docs](#documentation)

</div>

---

Browser automation clicks buttons, reads pixels, and burns tokens. OpenWeb calls the same APIs the website calls.

- **Fast, cheap, and token-efficient** — No screenshots, no vision API, no LLM-powered extraction.
- **Minimal effort per operation** — Direct HTTP when possible, browser only when needed. WebSocket and code adapters for maximal coverage. The right transport per site, automatically.
- **Predictable, structured output** — Typed params, response schemas, and examples for every operation. JSON in, JSON out.
- **Safe by default** — Read, write, delete, and transact operations gated by permission tiers. SSRF protection on every request.
- **Auth that just works** — Cookies, JWT, CSRF, request signing, exchange chains — auto-resolved per request. You never touch tokens.
- **Any site, any time** — 50+ sites out of the box across social, commerce, content, travel, finance, and more. Not listed? [Add it](#discover--compile).

## Quick Start

```bash
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

### With the agent skill

Just ask in natural language:

```
Use /openweb to summarize discussions on the latest AI news
/openweb Search for "laptop" across a few shopping websites
```

### With the CLI

```bash
openweb sites                              # list all sites
openweb <site>                             # site overview + operations
openweb <site> <operation>                 # operation detail + params
openweb <site> <op> '{...}'                # execute
```

Browser auto-starts when needed. Auth-required sites will open your browser for login automatically.

Full CLI reference: [`skill/openweb/references/cli.md`](skill/openweb/references/cli.md)
Troubleshooting: [`skill/openweb/references/troubleshooting.md`](skill/openweb/references/troubleshooting.md)

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

The agent drives the entire process — you stay in chat to make decisions when needed. All 50+ built-in sites were created this way.

```
Frame intents → Capture browser traffic → Analyze & detect auth → Generate typed spec → Verify → Learn
```

Each step involves agent judgment: choosing the right auth pattern, deciding if coverage is sufficient, curating operation names, and running independent verification. The knowledge base grows with every site compiled.

See [`skill/openweb/references/discover.md`](skill/openweb/references/discover.md) and [`skill/openweb/references/compile.md`](skill/openweb/references/compile.md) for the full workflow.

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

## Documentation

| | |
|---|---|
| [`doc/main/`](doc/main/) | Architecture, runtime, security |
| [`doc/dev/`](doc/dev/) | Development guides |

## Development

See [`CLAUDE.md`](CLAUDE.md) (symlinked as `AGENTS.md`) for project setup and conventions, and [`doc/dev/`](doc/dev/) for development guides.

```bash
git clone https://github.com/openweb-org/openweb.git
cd openweb
pnpm install && pnpm build
pnpm test && pnpm lint
```

## Disclaimer

OpenWeb is a tool for interacting with websites through their existing interfaces. Users are responsible for complying with each website's terms of service. This project is not affiliated with, endorsed by, or associated with any of the websites listed above.

## License

[MIT](LICENSE)
