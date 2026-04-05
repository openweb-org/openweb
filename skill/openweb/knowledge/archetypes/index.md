# Site Archetypes

Quick-reference matrix for identifying a site's type before discovery. Each row links to a profile with expected operations and curation expectations.

> Archetypes are heuristic starting points, not limiting checklists. Define targets based on user needs and actual site capabilities.

## Archetype Matrix

| Archetype | Typical Auth | Transport | Examples | Profile |
|-----------|-------------|-----------|----------|---------|
| **Social Media** | cookie_session + CSRF | node or page | Instagram, Reddit, X | [social.md](social.md) |
| **Messaging** | cookie_session, webpack_module_walk | page (adapter) | Discord, Telegram, WhatsApp | [social.md](social.md) |
| **Content Platforms** | varies (exchange_chain, sapisidhash) | node or page | YouTube, Wikipedia, ChatGPT | [social.md](social.md) |
| **E-commerce** | cookie_session + CSRF | node (SSR) or page | Walmart, Best Buy, eBay | [commerce.md](commerce.md) |
| **Travel** | cookie_session | node or page | Airbnb, Booking, Expedia | [commerce.md](commerce.md) |
| **Food Delivery** | cookie_session | node or page | DoorDash, Instacart, Starbucks | [commerce.md](commerce.md) |
| **Job Boards** | none or cookie_session | page (adapter) | Indeed, LinkedIn, Glassdoor | [commerce.md](commerce.md) |
| **Productivity / Enterprise** | sessionStorage_msal, cookie_session | node | Stripe, Linear, Asana | [enterprise.md](enterprise.md) |
| **Developer Tools** | cookie_session, none | node | GitHub, GitLab, Docker Hub | [enterprise.md](enterprise.md) |
| **Finance / Banking** | cookie_session, exchange_chain | node or page | Fidelity, Robinhood, Bloomberg | [enterprise.md](enterprise.md) |
| **Email** | oauth2, sessionStorage_msal | node | Gmail, Outlook | [enterprise.md](enterprise.md) |
| **Cloud / Storage** | bearer_token, sessionStorage_msal | node | Dropbox, OneDrive | [enterprise.md](enterprise.md) |
| **Weather / Data** | none | node | IP API, Exchange Rate | [data-apis.md](data-apis.md) |
| **Prediction / Fun** | none | node | Cat Facts, Chuck Norris | [data-apis.md](data-apis.md) |
| **Reference / Lookup** | none | node | REST Countries, Open Library | [data-apis.md](data-apis.md) |
| **Crypto / Finance (public)** | none | node | Exchange Rate | [data-apis.md](data-apis.md) |
| **News** | none | node | BBC, The Guardian | [data-apis.md](data-apis.md) |
| **Chinese Web** | cookie_session, none | page (adapter) | Bilibili, Weibo, Zhihu | [chinese-web.md](chinese-web.md) |

## How to Use

1. **Before discovery:** identify the archetype -> read the profile for expected operations
2. **During compile:** check curation expectations in the profile
3. **When stuck:** check if the profile mentions known blockers or anti-bot notes

## Profile Structure

Each profile contains:
- **Expected Operations** — typical operations to target during discovery
- **Typical Profile** — auth, transport, extraction, bot detection
- **Notable Patterns** — site-specific quirks that affect curation
- **Curation Checklist** — what to verify during compile review

## Related Knowledge

- [auth-routing.md](../auth-routing.md) — signal -> auth family routing table
- [auth-primitives.md](../auth-primitives.md) — per-primitive detection, config, gotchas
- [bot-detection.md](../bot-detection.md) — detection systems and transport impact
- [extraction.md](../extraction.md) — SSR, DOM, adapter extraction
- [ws.md](../ws.md) — WebSocket message and connection patterns
- [graphql.md](../graphql.md) — persisted queries, batching
