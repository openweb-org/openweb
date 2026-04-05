# Chinese Web

> Archetypes are heuristic starting points, not limiting checklists.

Nine Chinese websites with shared technical patterns distinct from Western web. Most require page transport (L3 adapter) due to custom anti-bot signing, SPA rendering, or DOM extraction.

## Site Matrix

| Site | Category | Auth | Ops | Status |
|------|----------|------|-----|--------|
| Bilibili | Video / Social | cookie_session | 10 | Active |
| Boss Zhipin | Recruiting | none | 7 | Quarantined -- bot detection; ref data APIs work via node |
| Ctrip (Trip.com) | Travel | none | 10 | Active |
| Douban | Media reviews | none | 10 | Active |
| JD.com | E-commerce | none | 4 | Active -- DOM extraction, no auth needed |
| Weibo | Social media | cookie_session | 10 | Active (login required) |
| Xiaohongshu | Social commerce | cookie_session | 3 | Active |
| Xueqiu | Finance / Social | cookie_session | 6 | Active -- node transport for most ops, page for timeline |
| Zhihu | Q&A / Knowledge | cookie_session | 10 | Quarantined -- fingerprints pending |

## Expected Operations

Operations vary by category -- use the relevant archetype profile (social, commerce, etc.) as a starting point. Common across Chinese sites:

- Search (read) -- every site has some form of search
- Content detail (read, by ID) -- article, video, product, stock quote
- User profile (read) -- author, seller, company
- Feed / trending (read, paginated) -- hot lists, rankings, recommendations
- Comments (read, paginated) -- nested or flat

## Cross-Site Common Patterns

### Most Sites Use Page Transport

Most Chinese sites require page (L3 adapter) transport for core operations. Direct HTTP fails due to custom signing, anti-bot measures, or SPA-only rendering.

**Exception: Xueqiu.** Search, quote, order book, and industry APIs work via node transport with `cookie_session` auth (`xq_a_token` cookie, set on page load, 24h expiry). Only the social timeline endpoint needs page transport due to `md5__1038` anti-bot hash. The `stock.xueqiu.com` quote/pankou APIs accept cross-domain cookies from xueqiu.com.

**Exception: reference data APIs.** Many Chinese sites expose public reference data endpoints (`/wapi/zpCommon/*`, `/api/config/*`) that work via node without bot detection. Use operation-level `transport: node` override for these while keeping page transport for core operations.

### Custom Anti-Bot Signing

Most Chinese sites implement proprietary request signing beyond standard CSRF:

| Site | Signing | Mechanism |
|------|---------|-----------|
| Bilibili | Wbi signing | MD5 hash of sorted params + mixing key (rotates) |
| JD | h5st signing (global.jd.com) | `window.PSign.sign()` with appId -- not used in current adapter (DOM extraction) |
| Xiaohongshu | X-s / X-t / X-s-common | Obfuscated signatures from `as.xiaohongshu.com` |
| Boss | Fingerprint-based | Blocks new tabs, detects automation |

**Impact:** The browser's JS handles signing automatically. Adapter extraction (`page.evaluate` with fetch) inherits it. Never attempt to replicate signing in Node.

### SSR and Hydration Patterns

| Site | Pattern | Data Location |
|------|---------|---------------|
| Xiaohongshu | page_global | `window.__INITIAL_STATE__` (Vue 3 SSR) |
| Zhihu | SSR + hydration | Question/answer content in initial HTML |
| Douban | DOM extraction | No API -- all content parsed from rendered HTML |
| Bilibili | API + SSR fallback | Video data embedded in SSR, also available via API |

### Rate Limiting and Session

Chinese sites are aggressive about rate limiting:
- Weibo rotates XSRF tokens
- Xiaohongshu triggers CAPTCHA on profiles
- Xueqiu tokens expire after 24h
- Boss/Zhihu are quarantined due to bot detection
- All sites default to zh-CN content (Ctrip has international version at us.trip.com)

### International Redirect

Some Chinese sites detect non-CN IP addresses and redirect to an international version (e.g., `ctrip.com` -> `trip.com`, `jd.com` -> `global.jd.com`). The international site may have a different API surface, auth, and bot detection. During capture, check whether you landed on the Chinese or international domain. Document which version the package targets in DOC.md.

## Curation Checklist

- [ ] Adapter correctly calls `page.evaluate(fetch(...))` or extracts from DOM
- [ ] Anti-bot signing handled by browser context (not replicated in Node)
- [ ] Login-required sites (Weibo, Xiaohongshu, Zhihu) have auth configured
- [ ] Rate limiting behavior documented in DOC.md Known Issues
- [ ] Quarantined sites (Boss, Zhihu) have blocking issues documented
- [ ] SSR extraction targets correct data path and handles framework wrappers
- [ ] Pagination cursor/offset works across multiple pages
- [ ] Response data is meaningful (not empty arrays or login redirects)
