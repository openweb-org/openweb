## Pipeline Gaps — Bluesky Discovery (2026-04-01)

### Doc gaps

**Problem:** discover.md says "Use capture with `--isolate --url`" but doesn't explain the "separate Playwright connection" pitfall for scripted capture. When a script connects to the browser via a separate `chromium.connectOverCDP()` call and uses `page.evaluate(fetch())`, those fetch calls execute in the browser context but the HAR recorder attached by `capture start` doesn't see them — because capture monitors pages via its own CDP session, not the browser's global network.

**Root cause:** capture-guide.md mentions "Separate Playwright connections don't work" under Capture Target Binding, but the Two-Phase Capture Script Template still uses `chromium.connectOverCDP()` which creates exactly this separate connection. The template works for `page.goto()` navigations (which generate real network traffic visible to any CDP session) but NOT for `page.evaluate(fetch())` calls (which are JavaScript-initiated fetches only visible to the CDP session that created the page).

**Suggested fix:**
1. Add explicit warning in the Two-Phase template: "IMPORTANT: `page.evaluate(fetch())` calls from this script may not appear in the capture HAR. Only `page.goto()` navigations and browser-initiated requests are reliably captured across CDP sessions."
2. Recommend the `compile --script` pattern instead of two-phase when scripted fetch calls are needed, since it creates the capture session in-process.

---

### Code gaps

**Problem:** The compiler's path normalization (`path-normalize.ts`) treats AT Protocol XRPC method names as path parameters. All XRPC calls like `/xrpc/app.bsky.actor.getProfile`, `/xrpc/app.bsky.feed.getFeed`, etc. are normalized to `/xrpc/{param}` and merged into a single operation.

**Root cause:** `path-normalize.ts` identifies path segments that vary across samples as parameters. Since all XRPC calls share the `/xrpc/` prefix and differ only in the method name segment, the normalizer treats the method name as a variable.

**Suggested fix:** Add a heuristic for dot-separated reverse-domain path segments (e.g., `app.bsky.feed.getPostThread`). When a path segment contains 3+ dot-separated components, treat it as a fixed method name rather than a variable. This pattern is unique to XRPC/AT Protocol and similar RPC conventions.

---

### Rules too loose

**Problem:** When compiling with `https://public.api.bsky.app`, the first capture (from bsky.app browsing with --isolate) labeled 102/3843 requests as API — the rest were from other sites visited in the same tab. The `--isolate` flag isolates to a single tab, but if that tab navigates to multiple sites, all traffic is captured.

**Root cause:** `--isolate` creates a dedicated tab and monitors that tab's traffic, but doesn't filter by domain. When the tab navigates away from the target URL, traffic from the new domain is still captured.

**Suggested fix:** Consider a `--domain-filter` flag for capture that only records requests matching the target domain (or a set of domains). This would prevent cross-site contamination when the tab navigates away.

---

### Missing automation

**Problem:** Manual spec curation was required for AT Protocol sites because the compiler's auto-curation can't handle the XRPC path pattern. This meant writing the entire openapi.yaml by hand — 9 operations, each with parameters, response schemas, and x-openweb metadata.

**Suggested fix:** After path normalization, if a single parameterized endpoint has >5 samples with distinct path parameter values, and those values follow a naming convention (e.g., reverse-domain like `app.bsky.*`), prompt for split into individual operations. This would allow auto-curation to produce individual operations that need only naming review, rather than requiring a full manual rewrite.
