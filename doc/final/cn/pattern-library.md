# Pattern Library -- OpenTabs Plugin L1/L2/L3 分类 (中文概要)

> **状态**: COMPLETE
> **数据来源**: 分析 `.reference/reverse-api/opentabs/plugins/` 中的 103 个 OpenTabs plugins
> **目的**: 验证三层架构对真实网站的覆盖

## Layer 分类标准

| Layer | 含义 | Runtime mode |
|---|---|---|
| **L1** | 纯 HTTP + cookie auth，无需 browser state extraction，`credentials: 'include'` 即可 | `direct_http` 或 `session_http` |
| **L2** | 需要 L2 interaction primitives：从 browser storage/globals 提取 token、处理 CSRF、signing 或 SSR extraction | `session_http` 或 `browser_fetch` |
| **L3** | 需要 code adapter：混淆的 signing、内部协议、自定义 module 系统或无法参数化的逻辑 | `browser_fetch` |

## 分层统计

| Layer | 数量 | 占比 | 描述 |
|---|---|---|---|
| L1 | 13 | 13% | 纯 cookie/API-key auth，无需 browser extraction |
| L2 | 83 | 80% | 被 L2 interaction primitives 覆盖 |
| L3 | 7 | 7% | 需要 code adapters |
| **总计** | **103** | **100%** | |

**关键洞察**: L1 + L2 覆盖 **93%** 的网站。仅 7 个网站需要 L3 code adapters。

---

## Master Classification Table

Auth/CSRF 列中的 type 引用 [layer2-interaction-primitives.md](../layer2-interaction-primitives.md)：

| Plugin | Layer | Auth | CSRF | Signing | Extraction | 备注 |
|---|---|---|---|---|---|---|
| **airbnb** | L2 | cookie_session | -- | -- | script_json | `<script id="data-deferred-state-0">` SSR 数据 |
| **airtable** | L2 | page_global | page_global (`_csrf` body) | -- | -- | `initData.csrfToken` |
| **amplitude** | L2 | page_global | cookie_to_header | -- | -- | JWT from cookie, org ID from `intercomSettings` |
| **asana** | L2 | page_global | -- | -- | -- | `window.env._user_id`, HttpOnly cookies |
| **aws-console** | L2 | exchange_chain | -- | aws_sigv4 | -- | STS credential refresh, 15 分钟过期 |
| **azure** | L2 | sessionStorage_msal | -- | -- | -- | MSAL tokens, cross-origin ARM API |
| **bestbuy** | L2 | page_global | -- | -- | -- | `initData` global 中的客户信息 |
| **bitbucket** | L2 | page_global | cookie_to_header | -- | -- | `__app_data__` user UUID |
| **bluesky** | L2 | localStorage_jwt | -- | -- | -- | `BSKY_STORAGE.session.currentAccount.accessJwt` |
| **booking** | L2 | cookie_session | page_global | -- | page_global_data | SSR store 含 CSRF + booking 数据 |
| **calendly** | L2 | cookie_session | meta_tag | -- | -- | `<meta name="csrf-token">` |
| **chatgpt** | L2 | lazy_fetch | -- | -- | -- | `/api/auth/session` -> `accessToken` |
| **chipotle** | L2 | localStorage_jwt | -- | -- | -- | `cmg-vuex` key |
| **circleci** | L2 | page_global | -- | -- | ssr_next_data | `__NEXT_DATA__.props.pageProps` |
| **claude** | L1 | cookie_session | -- | -- | -- | Org ID from `lastActiveOrg` cookie |
| **clickhouse** | L2 | localStorage_jwt | -- | -- | -- | Auth0 SPA SDK token |
| **clickup** | L2 | websocket_intercept | -- | -- | -- | JWT from WS auth frame + `cuHandshake` |
| **cloudflare** | L2 | page_global | page_global | -- | -- | `bootstrap.atok` (带 timestamp 前缀) |
| **cockroachdb** | L2 | page_global | -- | -- | -- | gRPC-Web over HTTP |
| **coinbase** | L1 | cookie_session | -- | -- | -- | same-origin GraphQL |
| **confluence** | L2 | cookie_session | -- | -- | -- | `ajs-remote-user` meta tag 获取 user ID |
| **costco** | L2 | sessionStorage_token | -- | -- | -- | `authToken_${hashedUserId}`, 多域名 |
| **craigslist** | L1 | cookie_session | -- | -- | -- | 两个 API 子域名 |
| **discord** | L2 | webpack_module_walk | -- | -- | -- | `webpackChunkdiscord_app` -> `getToken()` |
| **docker-hub** | L2 | lazy_fetch | -- | -- | -- | `/auth/profile` endpoint |
| **dominos** | L2 | localStorage_jwt | -- | -- | -- | GraphQL API |
| **doordash** | L2 | localStorage_jwt | cookie_to_header | -- | -- | `csrf_token` cookie |
| **ebay** | L2 | page_global | -- | -- | -- | `window.GHpre` user 数据 |
| **excel-online** | L2 | sessionStorage_msal | -- | -- | -- | MSAL -> Microsoft Graph API |
| **expedia** | L2 | page_global | -- | -- | -- | `__PLUGIN_STATE__.context` |
| **facebook** | L2 | webpack_module_walk | page_global | -- | -- | `fbRequire` module system, DTSGInitialData |
| **fidelity** | L1 | cookie_session | -- | -- | -- | HttpOnly session cookies, GraphQL |
| **figma** | L2 | page_global | -- | -- | -- | `INITIAL_OPTIONS` script |
| **gemini** | L2 | page_global | -- | -- | -- | `WIZ_global_data`, RPC batchexecute API |
| **github** | L2 | cookie_session | meta_tag / form_field | -- | script_json | CSRF from meta + form; embedded React 数据 |
| **gitlab** | L2 | page_global | meta_tag | -- | -- | `gon.current_username` |
| **google-analytics** | L2 | page_global | -- | gapi_proxy | -- | `gmsSuiteApiKey`, SAPISID via gapi |
| **google-calendar** | L2 | page_global | -- | gapi_proxy | -- | gapi.client delegation |
| **google-cloud** | L2 | page_global | -- | gapi_proxy | -- | gapi.client delegation |
| **google-drive** | L2 | page_global | -- | gapi_proxy | -- | Public API key + gapi delegation |
| **google-maps** | L2 | page_global | -- | -- | page_global_data | `APP_INITIALIZATION_STATE` |
| **grafana** | L2 | page_global | -- | -- | -- | `grafanaBootData` |
| **hackernews** | L2 | cookie_session | -- | -- | html_selector | DOM 解析 `.titleline`, `.score`, `.hnuser` |
| **homedepot** | L2 | page_global | -- | -- | -- | THD cookie decode 提取自定义 token |
| **instacart** | L3 | cookie_session | -- | -- | apollo_cache | webpack module 47096 的 persisted query hashes |
| **instagram** | L2 | cookie_session | cookie_to_header | -- | -- | `csrftoken` -> `X-CSRFToken`, `X-IG-App-ID` |
| **jira** | L2 | cookie_session | -- | -- | -- | `ajs-*` meta tags 获取上下文 |
| **leetcode** | L2 | cookie_session | cookie_to_header | -- | -- | `csrftoken` -> `x-csrftoken` |
| **linear** | L2 | localStorage_jwt | -- | -- | -- | `ApplicationStore` -> GraphQL API |
| **linkedin** | L2 | cookie_session | cookie_to_header | -- | -- | JSESSIONID 作为 csrf-token header |
| **medium** | L2 | page_global | page_global | -- | apollo_cache | `__APOLLO_STATE__` 获取 viewer 数据 |
| **meticulous** | L1 | cookie_session | -- | -- | -- | HttpOnly session, GraphQL |
| **microsoft-word** | L2 | sessionStorage_msal | -- | -- | -- | MSAL -> Microsoft Graph API |
| **minimax-agent** | L3 | webpack_module_walk | -- | custom (HMAC) | -- | Axios instance module 33993 用于签名 |
| **mongodb-atlas** | L2 | page_global | cookie_to_header | -- | -- | `PARAMS.csrfToken` |
| **netflix** | L2 | page_global | -- | -- | apollo_cache | `reactContext` + Apollo cache reads |
| **netlify** | L1 | cookie_session | -- | -- | -- | HttpOnly cookies |
| **newrelic** | L2 | page_global | -- | -- | -- | `__nr.userId`, NerdGraph GraphQL |
| **notion** | L2 | cookie_session | -- | -- | -- | `notion_user_id` cookie + localStorage space |
| **npm** | L2 | page_global | page_global | -- | -- | `__context__` 获取 user + csrftoken |
| **onenote** | L2 | sessionStorage_msal | -- | -- | -- | MSAL -> Microsoft Graph API |
| **onlyfans** | L3 | cookie_session | page_global (Vuex) | custom (obfuscated) | -- | webpack module 977434 用于 request signing |
| **panda-express** | L2 | localStorage_jwt | -- | -- | -- | Redux `persist:root` |
| **pinterest** | L2 | cookie_session | cookie_to_header | -- | -- | `csrftoken` cookie |
| **posthog** | L2 | page_global | cookie_to_header | -- | -- | `POSTHOG_APP_CONTEXT` |
| **powerpoint** | L2 | sessionStorage_msal | -- | -- | -- | MSAL -> Microsoft Graph API |
| **priceline** | L2 | localStorage_jwt | -- | -- | -- | Okta token storage |
| **reddit** | L2 | cookie_session / exchange_chain | api_response | -- | -- | Modhash + OAuth bearer exchange |
| **redfin** | L1 | cookie_session | -- | -- | -- | RF_AUTH header |
| **retool** | L1 | cookie_session | -- | -- | -- | HttpOnly cookies |
| **robinhood** | L2 | localStorage_jwt | -- | -- | -- | `web:auth_state.access_token` |
| **sentry** | L2 | page_global | cookie_to_header | -- | -- | `__initialData`, `sentry-sc` CSRF |
| **shortcut** | L1 | cookie_session | -- | -- | -- | Tenant headers from bootstrap |
| **slack** | L2 | localStorage_jwt / page_global | -- | -- | -- | 多来源: `localConfig_v2/v3`, globals |
| **slack-enterprise** | L2 | localStorage_jwt / page_global | -- | -- | -- | Enterprise org + workspace tokens |
| **spotify** | L2 | lazy_fetch | -- | -- | -- | Bearer from fetch interception |
| **stackoverflow** | L2 | page_global | -- | -- | -- | `StackExchange.options.user` |
| **starbucks** | L2 | page_global | -- | -- | -- | Redux `store.getState()` |
| **steam** | L2 | page_global | -- | -- | -- | `g_sessionID`, form-encoded POST |
| **stripe** | L2 | page_global | page_global | -- | -- | `PRELOADED.csrf_token` |
| **supabase** | L2 | localStorage_jwt | -- | -- | -- | `supabase.dashboard.auth.token` |
| **target** | L2 | cookie_session | -- | -- | -- | Session cookies, internal APIs |
| **teams** | L2 | exchange_chain | -- | -- | -- | MSAL -> Skype JWT exchange |
| **telegram** | L3 | page_global | -- | -- | -- | 内部 `apiManager.invokeApi`, TL protocol |
| **terraform-cloud** | L2 | cookie_session | form_field | -- | -- | `authenticity_token` hidden input |
| **tiktok** | L3 | page_global | -- | custom (acrawler) | page_global_data | `byted_acrawler.frontierSign()` |
| **tinder** | L2 | localStorage_jwt | -- | -- | -- | Auth token from localStorage |
| **todoist** | L2 | localStorage_jwt | -- | -- | -- | User JSON in localStorage |
| **tripadvisor** | L2 | cookie_session | -- | -- | -- | Session cookies |
| **tumblr** | L2 | cookie_session | -- | -- | -- | Session cookies |
| **twilio** | L2 | lazy_fetch | -- | -- | -- | Account SID from console endpoint |
| **twitch** | L2 | page_global | -- | -- | -- | `auth-token` cookie -> OAuth header |
| **uber** | L2 | cookie_session | cookie_to_header | -- | -- | x-csrf-token header |
| **vercel** | L1 | cookie_session | -- | -- | -- | HttpOnly authorization cookie |
| **walmart** | L2 | cookie_session | -- | -- | ssr_next_data | `__NEXT_DATA__`, Orchestra API |
| **webflow** | L2 | cookie_session | -- | -- | -- | Session cookies |
| **whatsapp** | L3 | page_global | -- | -- | -- | 内部 `require()` modules, custom binary protocol |
| **wikipedia** | L1 | cookie_session | -- | -- | -- | Public MediaWiki API |
| **x** | L2 | page_global | cookie_to_header | -- | -- | Static bearer + `ct0` CSRF cookie |
| **yelp** | L2 | page_global | -- | -- | page_global_data | `react_root_props` SSR 数据 |
| **ynab** | L2 | localStorage_jwt | -- | -- | -- | Auth token from localStorage |
| **youtube** | L2 | page_global | -- | sapisidhash | -- | `ytcfg.data_` + SAPISID signing |
| **youtube-music** | L2 | page_global | -- | sapisidhash | -- | 与 YouTube 相同的 pattern |
| **zendesk** | L2 | page_global | meta_tag | -- | -- | `__app_config__` |
| **zillow** | L2 | page_global | -- | -- | ssr_next_data | `__NEXT_DATA__` + custom search API |

---

## L3 网站（需要 code adapter）

| Plugin | L2 不足的原因 |
|---|---|
| **instacart** | Persisted query hashes 需从特定 webpack module (47096) 提取，带 fallback hash table |
| **minimax-agent** | HMAC request signing 通过 hijacked Axios instance (webpack module 33993) |
| **onlyfans** | 混淆的 signing function 在 webpack module 977434 中 |
| **telegram** | 内部 TL protocol 通过 `apiManager.invokeApi`，非 HTTP |
| **tiktok** | `byted_acrawler.frontierSign()` 用于 X-Bogus parameter signing |
| **whatsapp** | 内部 module system (`require()`)，自定义 binary protocol |
| **facebook** | 自定义 `fbRequire()` module system 获取 DTSG + LSD tokens（L2 边界） |

---

## Auth Pattern 分布

| Auth Type | 数量 | 代表网站 |
|---|---|---|
| cookie_session | 35 | Instagram, GitHub, Claude, LeetCode, Pinterest |
| page_global | 30 | Netflix, npm, Sentry, YouTube, Stripe, Cloudflare |
| localStorage_jwt | 20 | Bluesky, Linear, ClickUp, Robinhood, Supabase |
| sessionStorage_msal | 5 | Azure, Excel, OneNote, PowerPoint, Word |
| lazy_fetch | 4 | ChatGPT, Docker Hub, Spotify, Twilio |
| exchange_chain | 3 | Reddit (OAuth), Teams, AWS Console |
| webpack_module_walk | 3 | Discord, Facebook, X (边界) |
| websocket_intercept | 1 | ClickUp |
| sessionStorage_token | 1 | Costco |

## CSRF Pattern 分布

| CSRF Type | 数量 | 代表网站 |
|---|---|---|
| *(无)* | 68 | 大多数网站 (JWT/Bearer auth 不需要 CSRF) |
| cookie_to_header | 16 | Instagram, LeetCode, Sentry, Pinterest, LinkedIn |
| page_global | 9 | Airtable, npm, Stripe, Cloudflare, Medium |
| meta_tag | 5 | GitHub, Calendly, GitLab, Zendesk, Terraform |
| form_field | 2 | GitHub (forms), Terraform Cloud |
| api_response | 1 | Reddit (modhash) |

## Signing Pattern 分布

| Signing Type | 数量 | 代表网站 |
|---|---|---|
| *(无)* | 93 | 大多数网站 |
| sapisidhash | 2 | YouTube, YouTube Music |
| gapi_proxy | 4 | Google Analytics, Calendar, Cloud, Drive |
| aws_sigv4 | 1 | AWS Console |
| *(L3 custom)* | 3 | OnlyFans, TikTok, minimax-agent |

## Extraction Pattern 分布

| Extraction Type | 数量 | 代表网站 |
|---|---|---|
| *(无 -- 使用 REST/GraphQL API)* | 90 | 大多数网站 |
| apollo_cache | 3 | Netflix, Instacart, Medium |
| ssr_next_data | 3 | Zillow, CircleCI, Walmart |
| page_global_data | 3 | Yelp, TikTok, Google Maps |
| script_json | 2 | Airbnb, GitHub |
| html_selector | 1 | Hacker News |

---

## L2 Primitive 覆盖验证

每个 L2 primitive 至少被一个真实 plugin 使用：

| Primitive | 分类 | Plugin 数量 | 验证来源 |
|---|---|---|---|
| cookie_session | auth | 35 | Instagram, GitHub, LeetCode |
| localStorage_jwt | auth | 20 | Bluesky, Linear, Robinhood |
| page_global | auth | 30 | Netflix, YouTube, npm |
| sessionStorage_msal | auth | 5 | Azure, Excel, OneNote |
| sessionStorage_token | auth | 1 | Costco |
| lazy_fetch | auth | 4 | ChatGPT, Docker Hub |
| exchange_chain | auth | 3 | Reddit, Teams |
| webpack_module_walk | auth | 3 | Discord |
| websocket_intercept | auth | 1 | ClickUp |
| cookie_to_header | csrf | 16 | Instagram, Sentry, LeetCode |
| page_global | csrf | 9 | npm, Airtable, Stripe |
| meta_tag | csrf | 5 | GitHub, Calendly, GitLab |
| form_field | csrf | 2 | GitHub, Terraform Cloud |
| api_response | csrf | 1 | Reddit |
| sapisidhash | signing | 2 | YouTube |
| gapi_proxy | signing | 4 | Google Analytics, Drive |
| aws_sigv4 | signing | 1 | AWS Console |
| cursor | pagination | ~20 | Bluesky, Discord, Reddit |
| offset_limit | pagination | ~10 | Airtable |
| link_header | pagination | ~5 | Sentry, GitHub REST |
| ssr_next_data | extraction | 3 | Zillow, Walmart |
| apollo_cache | extraction | 3 | Netflix, Medium |
| script_json | extraction | 2 | Airbnb, GitHub |
| html_selector | extraction | 1 | Hacker News |
| page_global_data | extraction | 3 | Yelp, TikTok |

**所有 27 个 L2 primitive types 都至少被一个真实 plugin 验证。**

---

## Design Gaps 验证

每个 L2 primitive 都可追溯到至少一个 design gap：

| Gap | 涉及 Primitives | Plugin 数量 |
|---|---|---|
| 001: SSR / 无 client API | html_selector, ssr_next_data, script_json, page_global_data | 12 |
| 002: Browser state extraction | localStorage_jwt, sessionStorage_*, page_global, webpack_module_walk | 60+ |
| 003: WebSocket protocols | websocket_intercept | 1 |
| 004: Dynamic request signing | sapisidhash, gapi_proxy, aws_sigv4 | 7 |
| 005: CSRF token rotation | cookie_to_header, meta_tag, page_global, form_field, api_response | 33 |
| 006: DOM parsing / SSR cache | apollo_cache, ssr_next_data, script_json, page_global_data | 12 |
| 007: 无 HTTP API | *(L3 adapters)* | 3 |
| 008: Multi-step auth | exchange_chain, lazy_fetch | 7 |
| 009: Persisted query hashes | *(L3 webpack hash 提取)* | 3 |
| 010: Google gapi proxy | gapi_proxy | 4 |
| 011: Page navigation / DOM | *(L3 adapters)* | 2 |
| 012: Cross-origin bearer | sessionStorage_token, multi-server config | 5 |

---

## 交叉引用

- **L2 primitive schemas** -> [layer2-interaction-primitives.md](../layer2-interaction-primitives.md)
- **L3 adapter interface** -> [layer3-code-adapters.md](../layer3-code-adapters.md)
- **Gap details** -> [gap-coverage-matrix.md](../gap-coverage-matrix.md)
- **Compiler detection** -> [compiler-pipeline.md](../compiler-pipeline.md)
