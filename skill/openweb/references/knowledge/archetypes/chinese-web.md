# Chinese Web

> Archetypes are heuristic starting points, not limiting checklists.

## Classification

Nine Chinese websites with shared technical patterns distinct from Western web. All require page transport (L3 adapter) due to custom anti-bot signing, SPA rendering, or DOM extraction.

| Site | Category | Auth | Ops | Status |
|------|----------|------|-----|--------|
| Bilibili | Video / Social | cookie_session | 10 | Active |
| Boss Zhipin | Recruiting | none | 10 | Quarantined — bot detection |
| Ctrip (Trip.com) | Travel | none | 10 | Active |
| Douban | Media reviews | none | 10 | Active |
| JD.com | E-commerce | none | 5 | Active (limited) |
| Weibo | Social media | cookie_session | 10 | Active (login required) |
| Xiaohongshu | Social commerce | cookie_session | 3 | Active |
| Xueqiu | Finance / Social | none* | 10 | Active |
| Zhihu | Q&A / Knowledge | cookie_session | 10 | Quarantined — fingerprints pending |

*Xueqiu: `xq_a_token` cookie set automatically on page load (24h expiry).

## Expected Operations

Operations vary by category — use the relevant archetype profile (social, commerce, etc.) as a starting point. Common across Chinese sites:

- Search (read) — every site has some form of search
- Content detail (read, by ID) — article, video, product, stock quote
- User profile (read) — author, seller, company
- Feed / trending (read, paginated) — hot lists, rankings, recommendations
- Comments (read, paginated) — nested or flat

## Cross-Site Common Patterns

### All Sites Use Page Transport

Every Chinese site requires page (L3 adapter) transport. Direct HTTP fails due to custom signing, anti-bot measures, or SPA-only rendering. No exceptions in the current set.

### Custom Anti-Bot Signing

Most Chinese sites implement proprietary request signing beyond standard CSRF:

| Site | Signing | Mechanism |
|------|---------|-----------|
| Bilibili | Wbi signing | MD5 hash of sorted params + mixing key (rotates) |
| JD | h5st signing | `window.PSign.sign()` with appId |
| Xiaohongshu | X-s / X-t / X-s-common | Obfuscated signatures from `as.xiaohongshu.com` |
| Boss | Fingerprint-based | Blocks new tabs, detects automation |

**Impact:** The browser's JS handles signing automatically — adapter extraction (page.evaluate with fetch) inherits it. Never attempt to replicate signing in Node.

### SSR and Hydration Patterns

Several sites embed data in the initial HTML rather than (or alongside) API calls:

| Site | Pattern | Data Location |
|------|---------|---------------|
| Xiaohongshu | page_global | `window.__INITIAL_STATE__` (Vue 3 SSR) |
| Zhihu | SSR + hydration | Question/answer content in initial HTML |
| Douban | DOM extraction | No API — all content parsed from rendered HTML |
| Bilibili | API + SSR fallback | Video data embedded in SSR, also available via API |

### Rate Limiting and Session

Chinese sites are aggressive about rate limiting. Weibo rotates XSRF tokens; Xiaohongshu triggers CAPTCHA on profiles; Xueqiu tokens expire after 24h; Boss/Zhihu are quarantined due to bot detection. All sites default to zh-CN content (Ctrip has international version at us.trip.com).

## Curation Expectations

- [ ] Adapter correctly calls `page.evaluate(fetch(...))` or extracts from DOM
- [ ] Anti-bot signing is handled by browser context (not replicated in Node)
- [ ] Login-required sites (Weibo, Xiaohongshu, Zhihu) have auth configured
- [ ] Rate limiting behavior documented in DOC.md Known Issues
- [ ] Quarantined sites (Boss, Zhihu) have blocking issues documented
- [ ] SSR extraction targets the correct data path and handles framework wrappers
- [ ] Pagination cursor/offset works across multiple pages
- [ ] Response data is meaningful (not empty arrays or login redirects)
