# Skill Package Format & Runtime

*Part of the [web-skill design](web-skill-design.md). See also: [Architecture Pipeline](architecture-pipeline.md), [Security Taxonomy](security-taxonomy.md).*

---

## 4. Per-Website Skill Package Format

Each generated skill is a self-contained directory:

```
google-flights-web-skill/
├── SKILL.md                    # Claude Code skill entry point
├── manifest.json               # Package metadata & version
├── tools/
│   ├── search_flights.json     # Tool definition (schema + execution config)
│   ├── get_flight_details.json
│   ├── select_fare.json
│   ├── create_booking.json
│   └── ...
├── workflows/
│   ├── find_cheapest.yaml      # Task-level workflow DAGs
│   ├── book_with_coupon.yaml
│   └── ...
├── templates/
│   ├── search.http             # Request templates with placeholders
│   ├── booking.http
│   └── ...
├── extractors/
│   ├── csrf.js                 # Extract CSRF token from page
│   ├── session_state.js        # Extract session-dependent values
│   └── ...
├── verifiers/
│   ├── search_flights.js       # Success/failure assertions
│   └── ...
├── tests/
│   ├── search_roundtrip.json   # Recorded input -> expected output shape
│   └── ...
├── fingerprints/
│   └── site_fingerprint.json   # Version detection hashes
└── bridge/
    └── executor.js             # In-browser execution bridge
```

### manifest.json

```json
{
  "name": "google-flights-web-skill",
  "version": "1.0.0",
  "site": "google.com/travel/flights",
  "generated_at": "2025-02-26T12:00:00Z",
  "generated_by": "web-use-skill v0.1.0",
  "capabilities": {
    "read": ["search_flights", "get_flight_details", "list_fares"],
    "write": ["select_fare", "create_booking"],
    "requires_auth": true,
    "requires_human": ["create_booking"]
  },
  "tool_count": 7,
  "workflow_count": 3,
  "test_count": 12
}
```

### SKILL.md (generated)

```yaml
---
name: google-flights-web-skill
description: >
  Interact with Google Flights via structured API calls.
  Supports flight search, fare comparison, and booking workflows.
  Requires an active browser session with Google account login.
user-invocable: true
allowed-tools: Bash, Read, Write, WebFetch
---

# Google Flights Web Skill

This skill provides structured tools for interacting with Google Flights
without manual browser navigation.

## Available Tools

- `search_flights(origin, dest, date, passengers)` -> flight list
- `get_flight_details(offer_id)` -> fare details, baggage, rules
- `list_fares(offer_id)` -> available fare classes with prices
- `select_fare(offer_id, fare_key)` -> booking state
- `list_available_coupons(offer_id)` -> applicable promotions
- `apply_coupon(offer_id, coupon_code)` -> updated price
- `create_booking(offer_id, passenger_info)` -> booking confirmation

## Workflows

- `find_cheapest`: Search and sort by price
- `book_with_coupon`: Full booking flow with coupon optimization

## Tool specifications

See [tools/](tools/) for full JSON Schema definitions.
See [workflows/](workflows/) for task-level DAGs.
```

---

## 5. The Meta-Skill: web-use-skill

The meta-skill is a Claude Code skill that drives the entire pipeline. It is
invoked by the user to generate a new per-website skill.

### SKILL.md

```yaml
---
name: web-use-skill
description: >
  Generate a structured API skill package for any website.
  Analyzes site traffic, extracts endpoints, infers schemas,
  and produces a tested, self-healing skill package.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, Task
---

# web-use-skill: Website-to-API Skill Compiler

Generate a per-website skill package that lets AI agents interact with
a website through structured API calls instead of GUI simulation.

## Usage

```
/web-use-skill https://www.google.com/travel/flights
```

## Process

### Step 1: Site Reconnaissance (Agent-Driven)
- Open the target URL in a Playwright-controlled browser
- Agent reads a11y tree / screenshot to understand the site
- Identify the site's category (e-commerce, travel, social, SaaS, etc.)
- Map out primary user flows (search, browse, detail, action)
- Generate a task plan with concrete parameter variations
- Use knowledge/patterns/ to recognize known site architectures
- Human only intervenes for login/2FA/CAPTCHA if needed

### Step 2: Flow Recording (Agent-Driven)
For each task in the plan:
- Agent navigates the site using a11y tree + screenshots
- Performs 3+ runs per flow with different inputs
- CDP passively records all network traffic as C-HAR
- If agent gets stuck (>N actions without progress), hand off to human
- Human completes the blocker, agent resumes

### Step 2.5: Execution Mode Probing
For each endpoint found during recording:
- Replay via direct HTTP (no browser) to test if it works
- If it fails, retry with exported cookies
- If that fails, retry with cookies + CSRF token
- If all fail, classify as requiring headless browser
- Skip probing for write endpoints (default to headless browser)
- Use knowledge/probe-heuristics.json to prioritize probe order

### Step 3: API Extraction
- Cluster recorded requests into endpoint groups
- Differentiate parameters (user input vs session vs CSRF vs derived)
- Induce JSON schemas from request/response samples
- Build the inter-endpoint dependency graph
- Generate human-readable tool descriptions using LLM

### Step 4: Needs Analysis (PM Mode)
Act as a product manager to identify common user needs:
- Analyze the recorded flows to extract the "funnel" structure
- Map flows to a domain-specific intent library:
  - E-commerce: search, filter, compare, coupon, cart, checkout
  - Travel: search, filter, fare rules, baggage, booking
  - Social: post, comment, like, follow, search, message
- Identify site-specific features (loyalty programs, deals, etc.)
- Prioritize tools by likely usage frequency

### Step 5: Skill Package Generation
- Synthesize tool definitions with dual execution paths (API + UI fallback)
- Compose workflow DAGs for common tasks
- Generate verifiers and test cases
- Compute site fingerprints
- Write SKILL.md, manifest.json, and all supporting files

### Step 6: Validation
- Execute each tool against the live site
- Verify outputs match expected schemas
- Run workflow smoke tests
- Report coverage: which flows are API-ified vs UI-only

## Output
A directory at `.claude/skills/<site>-web-skill/` ready for immediate use.

## Knowledge Base
This skill maintains a self-evolving knowledge base. Each build enriches it:
- `knowledge/patterns/` -- recognized site architecture patterns (Next.js, GraphQL, etc.)
- `knowledge/anti-bot/` -- anti-bot system signatures and countermeasures
- `knowledge/extractors/` -- reusable CSRF/token extraction templates
- `knowledge/probe-heuristics.json` -- empirical probe success rates by signal
- `knowledge/failure-playbook.md` -- known failure modes and fixes
- `history/` -- build log for every site processed to date
See [self-evolution.md Section 8](self-evolution.md#8-meta-skill-self-evolution) for full details on the evolution loop.

## Supporting files
- For the C-HAR recording format, see [recording-format.md](recording-format.md)
- For the tool schema specification, see [tool-spec.md](tool-spec.md)
- For the clustering algorithm details, see [clustering.md](clustering.md)
```

---

## 6. Execution Runtime: MCP Server

The skill packages need a runtime to actually execute tools. This is implemented
as an MCP (Model Context Protocol) server that provides tools to Claude Code.

### Architecture

```
Claude Code
    |
    |-- MCP protocol (stdio) -->  web-skill-mcp-server
                                      |
                                      |-- Playwright browser instance
                                      |     |
                                      |     |-- Page context (logged-in session)
                                      |     |-- In-page bridge.js
                                      |     |-- CDP network monitoring
                                      |
                                      |-- Skill registry
                                      |     |
                                      |     |-- google-flights-web-skill/
                                      |     |-- amazon-web-skill/
                                      |     |-- ...
                                      |
                                      |-- Execution engine
                                            |
                                            |-- Token refresher
                                            |-- Verifier runner
                                            |-- Fallback controller
                                            |-- Self-heal trigger
```

### MCP Tool Surface

The MCP server exposes these meta-tools plus dynamically loaded per-site tools:

**Meta-tools (always available):**

| Tool | Description |
|---|---|
| `web_skill_list_sites()` | List all installed skill packages |
| `web_skill_list_tools(site)` | List tools for a specific site |
| `web_skill_call(site, tool, args)` | Execute a tool against the site |
| `web_skill_run_workflow(site, workflow, args)` | Execute a multi-step workflow |
| `web_skill_status(site)` | Check site health (fingerprint match, test status) |
| `web_skill_heal(site)` | Trigger self-healing for a site |

**Per-site tools (dynamically registered):**

When a site skill is loaded, its tools are registered directly as MCP tools. For example, loading `google-flights-web-skill` would register:
- `google_flights__search_flights(origin, dest, date, passengers)`
- `google_flights__get_flight_details(offer_id)`
- etc.

This allows Claude to call them directly without going through `web_skill_call()`.
