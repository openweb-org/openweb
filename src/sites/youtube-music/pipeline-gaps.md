# YouTube Music — Pipeline Gaps

## Body-Discriminated POST Endpoints Collapse into One Cluster

**Problem:** YouTube Music's `/youtubei/v1/browse` endpoint serves albums, playlists, artists, home, and charts — all differentiated by the `browseId` field in the POST body. The analyzer clustered all 9 browse samples into a single operation `createYoutubeiBrowse`.

**Root cause:** `src/compiler/analyzer/` clusters by `(method, pathTemplate)`. POST-body-discriminated endpoints share the same path, so they collapse. GraphQL has a special sub-clustering pass (`graphql-cluster.ts`) that splits by `operationName`/`queryId`, but no equivalent exists for non-GraphQL body-discriminated APIs.

**Suggested fix:** Add a generic body-key sub-clustering heuristic. When a single POST cluster has high sample variance in a specific body field (e.g., `browseId` values with distinct prefixes like `MPREb_`, `VL`, `UC`, `FEmusic_`), sub-cluster by that field. This pattern appears in InnerTube (YouTube, YouTube Music), and likely other envelope-style APIs.

## Noise Operations Dominate Generated Spec

**Problem:** The auto-generated spec included `/api/stats/qoe` (6 samples, 50+ params), `/verify_session`, `/youtubei/v1/log_event`, and `/youtubei/v1/account/get_setting_values`. These are telemetry/internal endpoints. The QoE endpoint alone produced more query params than all real API operations combined.

**Root cause:** The labeler (`labeler.ts`) categorized these as `api` because they return JSON and are on the same domain. The path names (`stats/qoe`, `log_event`) match existing noise patterns listed in `spec-curation.md` but the auto-curation step doesn't filter them.

**Suggested fix:** Auto-curation should apply the same noise exclusion rules from `spec-curation.md` automatically — paths containing `stats`, `log`, `log_event`, `qoe`, `verify_session`, `get_setting_values` are almost always noise. A conservative denylist applied at auto-curation time would save significant manual work.

## Auth Detection False Positive: Timezone Cookie as CSRF

**Problem:** The compiler detected `cookie_to_header` CSRF with `av-timezone` cookie → `x-youtube-time-zone` header. This is a timezone preference, not a CSRF token.

**Root cause:** `csrf-detect.ts` matches any cookie whose value appears in a request header. Short preference values (timezone strings) can match headers. The current filter checks value length but timezone strings like `America/New_York` pass the minimum length threshold.

**Suggested fix:** Add a semantic denylist for known non-CSRF cookie-header pairs. Headers containing `timezone`, `locale`, `language`, `country` are preferences, not CSRF tokens. Also: if the matched header value is a well-known timezone string (IANA format), skip it.
