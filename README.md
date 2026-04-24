<div align="center">

# OpenWeb

**Agent-native way to access any website.**
**Bridging agent CLI and web GUI through API.**

[![npm version](https://img.shields.io/npm/v/@openweb-org/openweb)](https://www.npmjs.com/package/@openweb-org/openweb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick Start](#quick-start) · [Install](#install) · [How It Works](#how-it-works) · [Discover](#discover) · [Sites](#sites) · [Docs](#documentation)

</div>

---

Browser automation clicks buttons, reads DOM, and burns tokens. OpenWeb calls the same APIs the website calls — when it can — and directly accesses the structured data underneath.

- **Fast, cheap, and token-efficient** — No screenshots, no LLM page interpretation. Structured JSON in, structured JSON out.
- **Minimal effort per operation** — Direct HTTP when it works, browser-backed fetch when the site requires it, and code adapters for maximal flexibility. The right transport per operation, automatically — the caller never chooses or cares.
- **Predictable, typed API** — Typed params, response schemas, and examples for every operation.
- **Auth that just works** — Cookies, JWT, CSRF, request signing, exchange chains — auto-resolved per request. You never touch tokens.
- **Safe by default** — Read, write, delete, and transact operations gated by permission tiers. SSRF protection on every request.
- **Any site, any time** — 90+ sites out of the box across social, commerce, content, travel, finance, and more. Not listed? [Add it](#discover).

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

Works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [OpenCode](https://opencode.ai), [OpenClaw](https://github.com/openclaw/openclaw), [Hermes](https://hermes-agent.nousresearch.com), and all agents supporting skills. After install, add to your project instructions (`CLAUDE.md` / `AGENTS.md`):

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
| **Social** | x(29), tiktok(25), instagram(24), bluesky(22), reddit(17), zhihu(17), weibo(16), xiaohongshu(14), discord(14), telegram(13), linkedin(12), pinterest(11), whatsapp(8), quora(4) |
| **Content & Media** | hackernews(18), youtube(15), bilibili(15), wikipedia(14), medium(14), douban(14), spotify(13), steam(11), google-search(10), youtube-music(9), twitch(7), substack(4), soundcloud(4), goodreads(4), imdb(4), apple-podcasts(4), rotten-tomatoes(3) |
| **Commerce** | costco(14), amazon(8), walmart(5), bestbuy(5), homedepot(5), ebay(3), etsy(4), jd(4), target(5), instacart(3), zillow(4), redfin(3), craigslist(3), goodrx(3) |
| **Dev & Research** | github(18), gitlab(17), chatgpt(6), notion(7), trello(7), todoist(6), stackoverflow(5), huggingface(5), producthunt(4), npm(4), docker-hub(3), pypi(3), arxiv(3), google-scholar(3) |
| **Finance** | robinhood(14), fidelity(13), xueqiu(10), yahoo-finance(9), bloomberg(7), angellist(6), coingecko(5), seeking-alpha(4), coinmarketcap(3) |
| **News & Sports** | espn(6), bbc-news(4), techcrunch(4), reuters(4), guardian(3), cnn(3), npr(3) |
| **Travel** | google-maps(14), ctrip(13), tripadvisor(7), expedia(6), booking(5), google-flights(5), airbnb(5), uber(3), kayak(2), yelp(2) |
| **Food & Delivery** | ubereats(8), doordash(5), opentable(4), starbucks(3), grubhub(3) |
| **Jobs & Career** | indeed(8), boss(7), glassdoor(4), linkedin (cross-listed from Social), leetcode(12) |

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

## Trust & Side Effects

What OpenWeb does on your machine:

- **Network:** outbound HTTPS to the websites you ask the agent to use. No telemetry. No openweb-org backend or proxy in the request path. SSRF protection on every request blocks private/internal addresses by default.
- **Browser process:** a managed Chrome instance (via Chrome DevTools Protocol) auto-starts when a site requires browser-backed fetch. Auth-required sites may open your default browser for login; cookies stay in your browser and OpenWeb reuses your existing session.
- **Files written:** skill files into the standard skill directory of each detected agent (Claude Code, Codex, OpenCode, OpenClaw). Per-site config and cache live under `$OPENWEB_HOME` (defaults to `~/.openweb`).
- **Permissions:** every operation is tagged `read` / `write` / `delete` / `transact`. Read runs by default; write and delete throw `permission_required`; transact throws `permission_denied`. Grant by setting the policy in `$OPENWEB_HOME/config.json` (per site or globally).
- **Platform:** Tested on macOS with Google Chrome. Linux is lightly tested for basic functionality. Windows paths are implemented but not yet tested. Requires Chrome installed.
- **Uninstall:** `bash install-skill.sh --uninstall` removes the skill files and the global CLI.

## Disclaimer

OpenWeb is for lawful use — personal automation, research, accessibility, and building agents on accounts and data you own or are authorized to access. **You are solely responsible** for complying with each site's Terms of Service, applicable laws (including computer-misuse and data-protection statutes), and the acceptable-use policies of any account you authenticate with.

Write, delete, and transactional operations run under your authenticated session — sites may rate-limit, suspend, or ban accounts that automate against their interface. **Do not** use OpenWeb to harvest third-party personal data at scale, evade anti-abuse systems, or access systems without authorization.

Not affiliated with, endorsed by, or associated with any listed website. Provided "as is" with no warranty; see [LICENSE](LICENSE).

## License

[MIT](LICENSE)
