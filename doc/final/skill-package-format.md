# Skill Package Format & Runtime

*Part of the [web-skill design](web-skill-design.md). See also: [Architecture Pipeline](architecture-pipeline.md), [Security Taxonomy](security-taxonomy.md).*

---

## Per-Website Skill Package Format

### Minimal Package Structure

```
google-flights-web-skill/
├── SKILL.md              # Human-readable skill description (for agents)
├── manifest.json         # Metadata + capabilities + fingerprint + dependency graph
├── tools/                # One self-contained JSON per tool
│   ├── search_flights.json
│   ├── get_flight_details.json
│   └── ...
├── extractors/           # JS snippets for complex token extraction (optional)
│   └── csrf.js
└── tests/                # Recorded input → expected output shape
    └── search_roundtrip.json
```

**5 items, not 10.** Every directory earns its existence by being necessary for the first working skill.

**What was eliminated and why:**
- `templates/` — redundant with `execution.api` in tool JSON
- `verifiers/` — inline `verify` expression in tool JSON
- `workflows/` — LLM agent plans from tool descriptions + dependency graph
- `fingerprints/` directory — a field in `manifest.json`
- `bridge/` — runtime code in the MCP server, not skill-specific

### Interoperability Model: MCP Core + Skills Wrappers

The package is runtime-canonical around `tools/*.json`. Wrappers are generated from this source of truth:

1. **MCP registration** (required): tools become callable operations for any MCP-compatible agent client.
2. **Agent Skills wrappers** (optional): generated docs/instructions for each ecosystem, referencing the same tool names and schemas.

Skills do not replace MCP transport. Skills improve ergonomics and reuse; MCP carries execution.

### manifest.json

```json
{
  "name": "google-flights-web-skill",
  "version": "1.0.0",
  "spec_version": "0.1.0",
  "site": "google.com/travel/flights",
  "generated_at": "2026-02-27T12:00:00Z",
  "requires_auth": true,
  "fingerprint": {
    "js_bundle_hash": "sha256:a1b2c3...",
    "api_endpoint_set_hash": "sha256:d4e5f6...",
    "last_validated": "2026-02-27T12:00:00Z"
  },
  "dependencies": {
    "search_flights.flights[].offer_id": "get_flight_details.offer_id",
    "get_flight_details.fare_key": "create_booking.fare_key"
  }
}
```

Design principles:
- No derived fields (tool_count, capability lists). Derive from `tools/*.json` at load time.
- `spec_version` field supports future format migration.
- `dependencies` encodes the inter-tool data flow graph — sufficient for LLM agents to plan multi-step sequences.

### Tool Definition (Self-Contained JSON)

Each tool file contains everything needed to execute it:

```json
{
  "name": "search_flights",
  "description": "Search for flights between two airports on a given date",
  "input_schema": {
    "type": "object",
    "properties": {
      "origin": { "type": "string", "description": "Origin airport IATA code (e.g., 'SFO')" },
      "destination": { "type": "string", "description": "Destination airport IATA code (e.g., 'JFK')" },
      "departure_date": { "type": "string", "format": "date", "description": "Departure date (YYYY-MM-DD)" },
      "passengers": { "type": "integer", "default": 1, "description": "Number of passengers" }
    },
    "required": ["origin", "destination", "departure_date"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "flights": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "offer_id": { "type": "string" },
            "airline": { "type": "string" },
            "price": { "type": "number" },
            "departure_time": { "type": "string" },
            "arrival_time": { "type": "string" },
            "stops": { "type": "integer" }
          }
        }
      }
    }
  },
  "execution": {
    "mode": "browser_fetch",
    "human_handoff": false,
    "api": {
      "method": "GET",
      "url_template": "https://www.google.com/travel/flights/api/search?origin={origin}&dest={destination}&date={departure_date}&pax={passengers}",
      "headers": { "Accept": "application/json" },
      "csrf_extractor": "document.querySelector('meta[name=csrf]').content"
    },
    "ui_fallback": {
      "steps": [
        "Navigate to https://www.google.com/travel/flights",
        "Type {origin} in 'Where from?' field",
        "Type {destination} in 'Where to?' field",
        "Select {departure_date} from date picker",
        "Click 'Search'"
      ]
    }
  },
  "verify": "response.status === 200 && Array.isArray(response.body?.flights) && response.body.flights.length > 0"
}
```

Key points:
- **Self-contained**: schema, execution config, verifier, and fallback all in one file.
- **Dual execution**: every tool has API path + UI fallback.
- **Inline verifier**: simple expression, not a separate JS module.
- **CSRF extractor**: inline for simple cases. For complex multi-step extraction (e.g., fetch a page, parse a script tag, extract a variable), reference an external file in `extractors/`.

### SKILL.md (Generated, User-Facing)

```markdown
# Google Flights Web Skill

Interact with Google Flights via structured API calls.
Supports flight search, fare comparison, and booking.

## Tools
- search_flights(origin, dest, date) → flight list
- get_flight_details(offer_id) → fare details
- create_booking(offer_id, passenger_info) → confirmation [requires human]

## Requirements
- Active browser session with Google account login
```

Short, user-facing. Implementation details live in tool JSON files, not here.

### Optional Wrapper Artifacts (Generated, Not Canonical)

For cross-agent distribution, the build can emit wrappers outside the canonical package core:
- `wrappers/claude/SKILL.md`
- `wrappers/generic/AGENTS.md`
- `wrappers/*/README.md`

These are derived artifacts. If they disagree with `tools/*.json`, `tools/*.json` wins.

---

## The Meta-Skill: web-use-skill

The meta-skill is invoked by the user to generate a new per-website skill.

### SKILL.md (User-Facing)

```markdown
# web-use-skill

Generate a structured API skill for any website.

## Usage
/web-use-skill https://www.google.com/travel/flights

## What it does
1. Opens the site and explores its functionality (agent-driven)
2. Extracts the underlying API endpoints from network traffic
3. Probes each endpoint to find the cheapest execution mode
4. Generates typed tool definitions with API + UI fallback paths
5. Tests the tools and produces a ready-to-use skill package

## Output
A skill directory at `.claude/skills/<site>-web-skill/`
```

12 lines. Implementation details live in internal docs, not in the user-facing SKILL.md.

---

## Execution Runtime: MCP Server

### Architecture

```
Claude Code (or any MCP client)
    |
    |-- MCP protocol (stdio) -->  web-skill-mcp-server
                                      |
                                      |-- Playwright browser instance
                                      |     |-- Page context (logged-in session)
                                      |     |-- In-page bridge.js
                                      |     |-- CDP network monitoring
                                      |
                                      |-- Skill registry
                                      |     |-- google-flights-web-skill/
                                      |     |-- amazon-web-skill/
                                      |     |-- ...
                                      |
                                      |-- Execution engine
                                            |-- Fallback controller
                                            |-- Token refresher
                                            |-- Verifier runner
                                            |-- Self-heal trigger
```

### MCP Tool Surface

**Meta-tools (always available):**

| Tool | Description |
|---|---|
| `web_skill_list()` | List all installed skill packages |
| `web_skill_status(site)` | Check site health (fingerprint match, test status) |
| `web_skill_heal(site)` | Trigger self-healing for a site |

**Per-site tools (dynamically registered):**

When a site skill is loaded, its tools are registered directly as MCP tools:
- `google_flights__search_flights(origin, dest, date, passengers)`
- `google_flights__get_flight_details(offer_id)`
- etc.

Agents call tools directly. No `web_skill_call()` indirection — that's double-dispatch that adds complexity without value.

### Skill Discovery

- Discovery: file system scan of skill directories at startup
- Hot-reloading: watch for new skill directories, register tools without restart
- Conflict: if two skills target the same site, use the newer version

### Versioning (MVP)

Version is a monotonic counter (1.0.0, 1.1.0, ...). No semver infrastructure until needed. Version increments whenever the skill is regenerated or self-healed.
