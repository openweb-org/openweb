# openweb

Let any agent access the web. 51 sites, 17 auth primitives, one command.

## Quick Start

```bash
npm install -g openweb
openweb init                                          # Seed 51 sites to ~/.openweb/sites/
openweb sites                                         # List all sites
openweb open-meteo get_forecast '{"latitude":52.52,"longitude":13.41}'
```

## Authenticated Sites

```bash
openweb browser start                 # Launch Chrome with your cookies
openweb instagram getTimeline '{}'   # Uses cached auth
```

## As Claude Code Skill

This repo includes a Claude Code skill at `.claude/skills/openweb/SKILL.md`.
The agent can use `/openweb` to access all 51 sites.

## Development

```bash
pnpm install && pnpm build
pnpm --silent dev sites               # Dev mode (reads ./src/sites/)
pnpm test                             # 359 tests
```
