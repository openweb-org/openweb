# Xueqiu Pipeline Gaps

## Doc gaps

**Problem:** The chinese-web archetype stated "All Sites Use Page Transport" as an absolute rule. Xueqiu's search, quote, order book, and industry APIs all work fine via node transport with cookie_session. Only the timeline endpoint needs page transport.
**Root cause:** `skill/openweb/references/knowledge/archetypes/chinese-web.md` — blanket statement without exceptions.
**Suggested fix:** Updated to "Most Sites Use Page Transport" with Xueqiu as a named exception. Future Chinese site discoveries should test node transport first before defaulting to page.

## Code gaps

**Problem:** The auto-curation `md5__1038` parameter (anti-bot hash) was marked as required in the generated spec for all endpoints that included it. Some endpoints (search, hot events, industry) work fine without it via node, while others (timeline) need it and fall back to HTML without it.
**Root cause:** `src/compiler/analyzer/` — all captured query parameters are marked required if they appeared in every sample.
**Suggested fix:** Parameters matching anti-bot patterns (`md5__*`, hash-like names with numeric suffixes) could be flagged as potentially optional / anti-bot in the analysis report, similar to how `dm_*` and `w_rid` are handled in spec-curation guidance.

## Rules too tight

**Problem:** The compiler generated 37 operations from 86 API samples. Many were noise (APM, config, passport), but the `stock.xueqiu.com` operations (f10/companyInfo, kline, etc.) all failed with 400 because the cross-origin `page.evaluate(fetch())` call from xueqiu.com couldn't reach stock.xueqiu.com with the right cookies. These are real, useful endpoints that the capture script triggered but couldn't replay correctly.
**Root cause:** The capture script used `page.evaluate(fetch('https://stock.xueqiu.com/...'))` from the xueqiu.com page context, which may have CORS or cookie issues for cross-origin requests. However, the SPA navigation to `/S/SH600519` did trigger native cross-origin API calls that were captured correctly (quotes work).
**Suggested fix:** For cross-origin API endpoints, the capture guide should recommend navigating to the API's domain first, then using `page.evaluate(fetch(...))` with relative paths. Alternatively, rely on SPA navigation (clicking through the UI) to naturally trigger cross-origin calls.
