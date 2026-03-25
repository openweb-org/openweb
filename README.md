# openweb

Agent-native way to access any website. Bridging agent CLI and human GUI through API.

## Quick Start

```bash
npm install -g @openweb-org/openweb

openweb sites                                              # List available sites
openweb open-meteo exec get_forecast '{"latitude":52.52,"longitude":13.41}'
openweb init                                               # Optional: local editable copies
```

## Usage

```bash
# Execute any operation
openweb <site> exec <operation> '{"param":"value"}'

# See available operations for a site
openweb <site> ops

# Run with verbose output
openweb <site> exec <operation> '{}' --verbose
```

## Browser Setup

Some sites require a browser session for authentication. This is separate from the default install — no browser is downloaded automatically.

```bash
# Install Playwright browsers (one-time)
npx playwright install chromium

# Start a browser session
openweb browser start              # Headed (default)
openweb browser start --headless   # Headless

# Authenticated operations use the running browser
openweb instagram exec getTimeline '{}'
```

## As a Claude Code Skill

OpenWeb ships as a Claude Code skill. Add the skill and the agent can access any site via `/openweb`.

## Development

```bash
git clone https://github.com/openweb-org/openweb.git
cd openweb
pnpm install && pnpm build
pnpm test
pnpm lint
pnpm --silent dev sites            # Dev mode (reads src/sites/)
```

## License

[MIT](LICENSE)
