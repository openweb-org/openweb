# Zillow Fixture — Progress

## 2026-03-23: Discovery blocked by PerimeterX

**What changed:**
- Attempted full discovery workflow: plan → capture → compile
- Browser navigation to zillow.com returned 403 with PX CAPTCHA
- Probed ~15 endpoints via curl (search API, GraphQL, autocomplete, property detail) — all 403
- Mobile Safari UA initially returned 200 on homepage (64KB), but search page still 403; PX flagged IP after repeated probes
- User attempted manual CAPTCHA solve in managed browser and default browser — both failed ("please try again" loop)
- Diagnosed as IP poisoning: curl probes accumulated risk score, blocking even real browser sessions
- Added zillow to `doc/blocked.md`
- Updated process docs with lessons learned (browser-first rule, transport degradation ladder, IP poisoning pattern)

**Why:**
- PerimeterX five-layer detection too aggressive for any current access method
- Key lesson: never use curl/fetch to probe during discovery — it poisons IP reputation

**Verification:** No fixture to verify. Confirmed all endpoints return 403 via curl; browser CAPTCHA unsolvable after IP poisoning.
**Commit:** 4690625, f176486
