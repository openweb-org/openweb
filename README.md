<div align="center">

# OpenWeb

**Agent-native way to access any website.**
**Bridging agent CLI and web GUI through API.**

[![npm version](https://img.shields.io/npm/v/@openweb-org/openweb)](https://www.npmjs.com/package/@openweb-org/openweb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick Start](#quick-start) · [Install](#install) · [How It Works](#how-it-works) · [Discover](#discover) · [Sites](#sites) · [Docs](#documentation)

</div>

---

Browser automation clicks buttons, reads pixels, and burns tokens. OpenWeb calls the same APIs the website calls.

- **Fast, cheap, and token-efficient** — No screenshots, no vision API, no LLM-powered parsing. JSON in, JSON out.
- **Minimal effort per operation** — Direct HTTP when it works, browser-backed fetch when the site requires it, and code adapters for maximal flexibility. The right transport per site, automatically — the caller never chooses or cares.
- **Predictable, typed API** — Typed params, response schemas, and examples for every operation.
- **Auth that just works** — Cookies, JWT, CSRF, request signing, exchange chains — auto-resolved per request. You never touch tokens.
- **Safe by default** — Read, write, delete, and transact operations gated by permission tiers. SSRF protection on every request.
- **Any site, any time** — 90+ sites out of the box across social, commerce, content, travel, finance, and more. Not listed? [Add it](#discover).

## Quick Start

```bash
npx @openweb-org/openweb sites
npx @openweb-org/openweb wikipedia getPageSummary '{"title":"World_Wide_Web"}'
```

> **Note:** OpenWeb is currently a CLI tool only. Programmatic API usage (importing as a library) is not supported — the package exposes only `bin` with no `main`, `exports`, or `types` fields.

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

See [`skills/openweb/SKILL.md`](skills/openweb/SKILL.md) for what the skill provides.

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

A managed browser auto-starts when needed. Auth-required sites may open your default browser for login.

Full CLI reference: [`skills/openweb/references/cli.md`](skills/openweb/references/cli.md)
Troubleshooting: [`skills/openweb/references/troubleshooting.md`](skills/openweb/references/troubleshooting.md)

## How It Works

Each site is a self-contained package:

```
src/sites/<site>/
  manifest.json       # identity, auth, stats
  openapi.yaml        # operations, params, response schemas
  adapters/           # JS transforms for complex sites
  examples/           # captured fixtures, used by --example and tests
  SKILL.md            # agent-facing usage notes (workflows, intent mapping)
  DOC.md              # operator notes (auth, transport, internals)
  PROGRESS.md         # site build history
```

The runtime reads the spec → builds the request (URL, headers, auth, CSRF) → dispatches via the right transport (HTTP, browser fetch, SSR, WebSocket) → returns structured JSON.

Auth, CSRF, and transport are declared in the spec via `x-openweb` extensions. Callers never configure them.

## Discover

Any website can become an OpenWeb site — just ask the agent skill:

```
/openweb Discover and add the search function on example.com.
```

The agent drives the entire process — you stay in chat to make decisions when needed. All 90+ built-in sites were created this way.

```
Frame intents → Probe site stack → Route per family → Capture & compile (if needed) → Build package → Verify → Learn
```

The probe step front-loads transport and data-source discovery — the agent learns whether to use direct HTTP, browser fetch, SSR extraction, or adapter/intercept *before* committing to capture. Each step involves agent judgment: choosing the right auth pattern, deciding if coverage is sufficient, curating operation names, and running independent verification. The knowledge base grows with every site added.

See [`skills/openweb/add-site/guide.md`](skills/openweb/add-site/guide.md) for the full workflow.

## Sites

90+ sites, 750+ operations (numbers in parentheses are per-site operation counts):

| Category | Sites |
|---|---|
| **Social** | instagram(24), x(29), reddit(17), bluesky(22), linkedin(12), weibo(16), xiaohongshu(14), zhihu(17), discord(14), telegram(13), whatsapp(8), tiktok(25), pinterest(11) |
| **Commerce** | amazon(8), walmart(5), target(5), costco(14), bestbuy(5), ebay(3), etsy(4), jd(4), instacart(3), homedepot(5) |
| **Food & Delivery** | doordash(5), grubhub(3), ubereats(8), starbucks(3), opentable(4) |
| **Content** | youtube(15), youtube-music(9), medium(14), substack(4), wikipedia(14), hackernews(18), bilibili(15), soundcloud(4), spotify(13), twitch(7), apple-podcasts(4), douban(14) |
| **Travel** | booking(5), expedia(6), google-flights(5), tripadvisor(7), kayak(2), ctrip(13), airbnb(5), uber(3) |
| **Finance** | robinhood(14), fidelity(13), yahoo-finance(9), xueqiu(10), bloomberg(7), coinmarketcap(3), coingecko(5), seeking-alpha(4) |
| **News** | bbc-news(4), cnn(3), reuters(4), guardian(3), techcrunch(4), npr(3), espn(6) |
| **Dev** | github(18), gitlab(17), leetcode(12), chatgpt(6), stackoverflow(5), docker-hub(3), huggingface(5), npm(4), pypi(3) |
| **Search** | google-search(10), google-maps(14), google-scholar(3) |
| **Jobs & Reviews** | indeed(8), glassdoor(4), goodreads(4), yelp(2), rotten-tomatoes(3), imdb(4) |
| **Real Estate** | zillow(4), redfin(3) |
| **Productivity** | notion(7), todoist(6), trello(7) |
| **Other** | craigslist(3), goodrx(3), producthunt(4), quora(4), steam(11), boss(7), arxiv(3) |

Run `openweb sites` for the source of truth — the table above is hand-maintained and may drift; the CLI also shows auth requirements.

## Documentation

| | |
|---|---|
| [`skills/openweb/`](skills/openweb/) | Shipped agent skill (router, references, add-site guides) |
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

> **Platform:** Tested on macOS with Google Chrome. Linux and Windows paths are implemented but not yet tested. Requires Chrome installed.

OpenWeb is for lawful use — personal automation, research, accessibility, and building agents on accounts and data you own or are authorized to access. **You are solely responsible** for complying with each site's Terms of Service, applicable laws (including computer-misuse and data-protection statutes), and the acceptable-use policies of any account you authenticate with.

Write, delete, and transactional operations run under your authenticated session — sites may rate-limit, suspend, or ban accounts that automate against their interface. **Do not** use OpenWeb to harvest third-party personal data at scale, evade anti-abuse systems, or access systems without authorization.

Not affiliated with, endorsed by, or associated with any listed website. Provided "as is" with no warranty; see [LICENSE](LICENSE).

## License

[MIT](LICENSE)
