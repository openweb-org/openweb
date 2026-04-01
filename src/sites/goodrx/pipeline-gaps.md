## Pipeline Gaps — GoodRx Discovery (2026-04-01)

### Page Closure During Sequential Navigation

**Problem:** Chrome tabs consistently close after 1-2 `page.goto()` calls when
navigating GoodRx via Playwright CDP. The `createCaptureSession` two-phase approach
and the `capture start --isolate` approach both suffer. Homepage loads fine, second
navigation triggers "Target page, context or browser has been closed."

**Root cause:** PerimeterX detection likely kills CDP-connected tabs after detecting
automation markers in sequential full-page navigations. Possibly related to
Playwright's CDP protocol extensions or rapid navigation fingerprints.

**Suggested fix:** For PerimeterX-heavy adapter-only sites, skip the capture→compile
flow entirely. The capture guide already documents the adapter-only workflow, but the
`discover.md` "Before You Start" section doesn't flag PerimeterX sites early enough
to avoid wasting a capture cycle. Add a rule: "If bot-detection-patterns.md lists
PerimeterX AND the archetype suggests DOM/JSON-LD data (no JSON APIs), go straight
to adapter-only workflow."

### Cold-Start Page Missing for First Verify Operation

**Problem:** `openweb verify <site> --browser` fails for the first adapter operation
(alphabetically) because no browser tab is open on the target site. Subsequent
operations succeed because the first operation's navigation created the tab. Running
verify twice works.

**Root cause:** `src/lifecycle/verify.ts` calls the adapter executor which requires
a page already on the target domain. The `--browser` flag starts Chrome but doesn't
pre-navigate to the site domain before running ops.

**Suggested fix:** In `verify.ts`, when `--browser` is set and transport is `page`
(or adapter), navigate a fresh tab to the site's `servers[0].url` before executing
the first operation. This would make cold-start verify reliable.

### Autocomplete API Endpoint Discovery

**Problem:** GoodRx's autocomplete endpoint path (`/api/autocomplete?searchTerm=...`)
had to be guessed — the capture produced only homepage traffic (CDN/tracking). No
systematic way to discover internal API endpoints on adapter-only sites.

**Root cause:** PerimeterX blocks Playwright navigation, so the capture never reaches
pages where the SPA search triggers API calls. And the search input itself is hidden
behind overlays during automated browsing.

**Suggested fix:** For adapter-only sites, add a "probe endpoints" step that tries
common API patterns (`/api/search`, `/api/autocomplete`, `/graphql`) from `page.evaluate(fetch)`
after the homepage loads. This discovers JSON APIs without needing to interact with
the UI.
