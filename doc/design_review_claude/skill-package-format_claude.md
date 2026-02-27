# Review: skill-package-format.md

**Reviewer:** Claude (system architect perspective)
**Date:** 2026-02-27
**Verdict:** The most over-engineered document in the set. The skill package has 8 subdirectories before a single site has been compiled. Needs aggressive pruning.

---

## The Fundamental Question This Document Doesn't Ask

> **How much structure does the LLM agent consuming these tools actually need?**

The document designs a skill package as if the consumer is a traditional software system that needs JSON Schemas, YAML workflow DAGs, verification scripts, fingerprint hashes, and an execution bridge. But the consumer is an LLM. LLMs don't need YAML workflow engines — they can plan tool sequences from natural language descriptions. LLMs don't need JSON Schema for type-checking — they need it for understanding what parameters to pass.

**Design from the consumer's needs, not the producer's capabilities.**

---

## What's Right (Keep These)

### 1. Skill as a Directory (Not a Prompt)

The decision to make a skill a directory of structured files rather than a monolithic prompt (Design Decision D5 in web-skill-design.md) is correct. Structured packages are:
- Diffable (git tracks changes per-file)
- Partially updatable (fix one tool without regenerating the whole skill)
- Testable (run verifiers per-tool)

**Keep the directory approach.** Simplify what goes in it.

### 2. Tool Definitions with Dual Execution Path

Each tool has both an API path and a UI fallback. This is the right architecture — graceful degradation is essential when your API extraction isn't perfect.

### 3. MCP Server as Runtime

The MCP server architecture — Playwright browser instance + skill registry + execution engine — is the right runtime model. Skill tool definitions are registered as MCP tools, making them directly callable by Claude.

---

## What's Over-Engineered (Simplify These)

### 4. The 8-Subdirectory Package Structure

Current:

```
google-flights-web-skill/
├── SKILL.md
├── manifest.json
├── tools/
├── workflows/
├── templates/
├── extractors/
├── verifiers/
├── tests/
├── fingerprints/
└── bridge/
```

**Why this is too much:**

- `templates/` contains `.http` files that duplicate information already in `tools/*.json` (the API endpoint template).
- `extractors/` is correct in concept but could be inline in the tool definition (a `csrf_extractor` field pointing to a JS snippet).
- `verifiers/` are simple success assertions that can be a `verify` field in the tool JSON.
- `fingerprints/` is one JSON file — it doesn't need its own directory.
- `bridge/` is one JS file — same.
- `workflows/` should not exist for MVP (see architecture-pipeline review).

**Simplified structure:**

```
google-flights-web-skill/
├── SKILL.md              # Human-readable skill description
├── manifest.json         # Metadata + capabilities + fingerprint
├── tools/                # One JSON per tool (includes schema, execution config, verifier)
│   ├── search_flights.json
│   ├── get_flight_details.json
│   └── ...
├── extractors/           # Reusable JS snippets for CSRF/token extraction
│   └── csrf.js
└── tests/                # Recorded input → expected output shape
    └── search_roundtrip.json
```

That's **5 items** instead of 10. Every removed directory is a removed concept, a removed abstraction, and a removed maintenance burden.

The `bridge/executor.js` can live in the MCP server (it's runtime code, not skill-specific). The `fingerprints/` data can be a field in `manifest.json`. The `templates/` files are redundant with `tools/`. The `workflows/` directory is premature.

### 5. manifest.json Has Redundant Fields

```json
{
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

`tool_count` can be derived from `ls tools/*.json | wc -l`. Don't store derived data.
`workflow_count` — workflows shouldn't exist yet.
`capabilities.read` and `capabilities.write` — this is a flat list of tool names. Can be derived from the tool files themselves (each tool knows if it's a read or write operation).

**Minimal manifest:**

```json
{
  "name": "google-flights-web-skill",
  "version": "1.0.0",
  "site": "google.com/travel/flights",
  "generated_at": "2025-02-26T12:00:00Z",
  "requires_auth": true,
  "fingerprint": {
    "js_bundle_hash": "sha256:a1b2c3...",
    "api_endpoint_set_hash": "sha256:d4e5f6...",
    "last_validated": "2025-02-26T12:00:00Z"
  }
}
```

Everything else is derivable or belongs in the tool definitions.

### 6. The Meta-Skill SKILL.md is an Implementation Spec

The meta-skill's SKILL.md (Section 5) has 6 steps with sub-bullets that describe the entire pipeline. This is correct for internal documentation but wrong for a SKILL.md file, which should tell the **user** what they can do:

```markdown
# web-use-skill

Generate a structured API skill for any website.

## Usage
/web-use-skill https://www.google.com/travel/flights

## What it does
1. Opens the site and explores its functionality
2. Extracts the underlying API endpoints
3. Generates typed tool definitions
4. Tests the tools and produces a ready-to-use skill package

## Output
A skill directory at `.claude/skills/<site>-web-skill/`
```

That's 12 lines. The current version is 60+ lines of implementation detail that the user doesn't need. Move the implementation details to internal docs.

### 7. MCP Meta-Tools Add Unnecessary Indirection

The MCP server exposes "meta-tools":

```
web_skill_list_sites()
web_skill_list_tools(site)
web_skill_call(site, tool, args)
web_skill_run_workflow(site, workflow, args)
web_skill_status(site)
web_skill_heal(site)
```

Plus per-site tools that are dynamically registered:
```
google_flights__search_flights(origin, dest, date, passengers)
```

**The meta-tools create double dispatch.** The agent can either call `web_skill_call("google-flights", "search_flights", {origin: "SFO"})` or call `google_flights__search_flights({origin: "SFO"})`. Having both paths means maintaining both paths, documenting both paths, and testing both paths.

**Simplification:** Only register per-site tools directly. Drop `web_skill_call()` and `web_skill_run_workflow()`. Keep only:

```
web_skill_list()        # What sites are available?
web_skill_status(site)  # Is this site's skill healthy?
web_skill_heal(site)    # Fix a broken skill
```

Plus dynamically registered per-site tools. That's 3 meta-tools, not 6.

---

## What's Missing

### 8. Tool Definition Schema is Underspecified

The tool JSON example in the document is detailed, but there's no canonical schema for tool definitions. What fields are required vs. optional? What are the allowed values for `execution.strategy`? What does the `fallback_chain` array look like?

A JSON Schema for tool definitions (meta-schema) would be more useful than all the example JSON in the document.

### 9. Versioning Strategy

`manifest.json` has a `version` field, but the document doesn't describe:
- When does the version increment?
- Is it semver? What constitutes a breaking change?
- How does the MCP server handle multiple versions of the same site's skill?

For MVP, version is just a monotonic counter. Don't build semver infrastructure until you need it.

### 10. Skill Discovery

How does the MCP server find installed skills? The document says skills live at `.claude/skills/<site>-web-skill/` but doesn't describe:
- Discovery mechanism (file system scan? registry file?)
- Hot-reloading (can you add a skill without restarting the server?)
- Conflict resolution (two skills for the same site?)

---

## Radical Simplification Proposal

**A tool definition should be ONE self-contained JSON file.** No external references, no separate templates, no separate verifiers. Everything a tool needs to execute should be in that file:

```json
{
  "name": "search_flights",
  "description": "Search for flights between two airports",
  "input_schema": { ... },
  "output_schema": { ... },
  "execution": {
    "mode": "headless_browser",
    "api": {
      "method": "GET",
      "url_template": "https://...",
      "headers": { ... },
      "csrf_extractor": "document.querySelector('meta[name=csrf]').content"
    },
    "ui_fallback": {
      "steps": ["Navigate to ...", "Type {origin} in ...", "Click Search"]
    }
  },
  "verify": {
    "success": "response.status === 200 && Array.isArray(response.body?.flights)"
  }
}
```

One file. No directory. No references. Self-contained. The CSRF extractor is an inline expression, not a reference to a separate file. The verifier is an inline expression, not a separate JS module. The UI fallback is inline instructions, not a separate template.

This eliminates the need for `templates/`, `extractors/` (for simple cases), `verifiers/`, and `bridge/` directories. For complex extractors (multi-step CSRF extraction), use an `extractors/` directory, but that should be the exception, not the default.

---

## Summary

| Aspect | Rating | Action |
|--------|--------|--------|
| Directory-based skill package | ★★★★★ | Keep |
| 8-subdirectory structure | ★★☆☆☆ | Reduce to 5 items |
| manifest.json | ★★★☆☆ | Remove derived fields |
| Tool JSON with dual execution | ★★★★☆ | Keep, make self-contained |
| Meta-skill SKILL.md | ★★☆☆☆ | Rewrite as user-facing, move impl details out |
| MCP meta-tools | ★★☆☆☆ | Reduce from 6 to 3 |
| Workflow YAML DSL | ★☆☆☆☆ | Drop for MVP |

**Bottom line:** This document designs for site #100 when you need to ship site #1. Every directory, every file, every abstraction should earn its existence by being necessary for the first working skill package. Start with the minimum viable structure, then add complexity only when real builds demand it. The current design has a 3:1 ratio of ceremony to substance.
