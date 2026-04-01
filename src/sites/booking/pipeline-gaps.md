# Pipeline Gaps — Booking.com

Issues discovered during the booking.com compile cycle that affect all sites.

## Adapter Import Portability

**Problem:** Adapter files that `import { OpenWebError } from '../../../lib/errors.js'` fail when loaded from the compile cache (`$OPENWEB_HOME/sites/<site>/adapters/`), because the relative path doesn't resolve outside the source tree.

**Root cause:** `src/sites/booking/adapters/booking-web.ts` — imports assume execution from within the `src/` directory structure. Compile cache copies the adapter file but not its dependencies.

**Suggested fix:** Adapters should be self-contained. Inline the CodeAdapter interface and error constructors (as amazon.ts does). The compile docs or spec-curation.md should mention this requirement for adapter files.

## First-Run DRIFT for New Packages

**Problem:** A newly created package with `response_shape_hash: "opName:pending"` in manifest.json always reports DRIFT on first verify, even though all operations work. The user's exit gate (`>=3 PASS`) cannot be met on the first run.

**Root cause:** `src/lifecycle/` fingerprint comparison — "pending" hashes never match the computed hash, so every operation reports DRIFT. After verify runs, the manifest is updated with real hashes.

**Suggested fix:** Either (1) treat `pending` as a wildcard that auto-accepts on first verify and writes the hash (PASS instead of DRIFT), or (2) document in verify.md that new packages need two verify runs — first to establish fingerprints (DRIFT), second to confirm (PASS).

## Standard Compile Inadequate for Adapter Sites

**Problem:** Running `openweb compile` on captured booking.com traffic produced 26 noise operations (tracking, consent APIs) and 0 usable hotel/flight operations. The entire adapter and spec had to be hand-written.

**Root cause:** Booking.com delivers hotel data via SSR HTML (LD+JSON, DOM), not JSON APIs. The standard pipeline labels HTML responses as non-API and clusters only JSON responses.

**Suggested fix:** The compile pipeline could detect LD+JSON blocks in HTML responses and suggest adapter extraction. When a site has `transport: page` in the archetype and the HAR shows primarily HTML responses, the summary should indicate "adapter extraction likely needed" rather than presenting only noise clusters.
