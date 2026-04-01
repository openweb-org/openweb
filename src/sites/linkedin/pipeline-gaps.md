## Pipeline Gaps — LinkedIn Discovery (2026-04-01)

### Multi-site HAR contamination

**Problem:** Browser-wide capture captures traffic from all open tabs (Amazon, X, LinkedIn). The compiler analyzed all 6081 entries but only 164 were LinkedIn API calls. Auth detection picked X's `ct0` CSRF cookie instead of LinkedIn's `JSESSIONID`.

**Root cause:** `capture start` without `--isolate` records all tabs. When the user has multiple tabs open, the HAR contains mixed-domain traffic.

**Suggested fix:** When `openweb compile <site-url>` is given a specific site URL, pre-filter the HAR to only include entries matching that domain before analysis. This is already partially done (labeler categorizes by domain) but auth detection operates on all entries globally.

### GraphQL variables array splitting

**Problem:** The compiler split Rest.li tuple-encoded `variables` query parameter values on commas, producing arrays like `["(start:3", "count:7", "paginationToken:..."]` instead of the single string `(start:3,count:7,paginationToken:...)`. This breaks replay because the executor sends array elements as separate query param values.

**Root cause:** `src/compiler/analyzer/` parameter inference treats comma-separated query values as arrays. LinkedIn's Rest.li tuples use commas inside parentheses as a structural delimiter, not as multi-value separators.

**Suggested fix:** Parameter inference should recognize parenthesized tuple syntax `(key:value,key:value)` and preserve it as a single string value. A heuristic: if a query param value starts with `(` and ends with `)`, treat it as atomic.

### Node transport redirect-loop rate limiting

**Problem:** Individual node-transport requests to LinkedIn succeed, but batch verify (13 sequential requests) triggers "Too many redirects (>5)" on all operations. Switching to page transport resolves the issue.

**Root cause:** LinkedIn's rate limiter or bot detection flags rapid sequential HTTP requests from a non-browser origin. The node transport extracts cookies from the browser but sends requests from Node.js, which has a different TLS fingerprint and no PerimeterX sensor data.

**Suggested fix:** For sites with PerimeterX detection (detectable via `_px3` cookie), the compiler should recommend `page` transport by default. Currently transport defaults to `node` regardless of bot detection signals.

### Search queryId mismatch

**Problem:** Scripted capture using `page.evaluate(fetch('/voyager/api/graphql?...'))` with guessed queryIds returned 500 for search operations. The queryId hash in the URL was stale or incorrect.

**Root cause:** LinkedIn's GraphQL queryIds are versioned hashes tied to the deployed frontend. Direct API calls with stale hashes fail. The UI-driven search uses current hashes loaded from the frontend bundle.

**Suggested fix:** For LinkedIn-style sites where queryIds rotate with deploys, document in the archetype that queryIds are ephemeral and must be captured via UI navigation, not guessed from documentation.
