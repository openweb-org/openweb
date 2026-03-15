# Pattern Library — Catalog of All Known Interaction Primitives

> **NEW in v2.** Growing catalog, populated from OpenTabs plugin analysis.

## TODO

For EACH pattern in Layer 2, create an entry with:
1. Pattern name and category
2. Schema (YAML config format with all parameters)
3. Which OpenTabs plugins use this pattern (with code references)
4. How the compiler detects it (signals in HAR + browser state)
5. How the runtime executes it
6. Real site example (full x-openweb YAML snippet)

### Sources for pattern extraction

Study these OpenTabs plugins to extract concrete patterns:
- Auth: Linear, ClickUp, Bluesky, OneNote, Costco, Discord, Netflix
- CSRF: Instagram, GitHub, Calendly, Airtable, Stripe, npm
- Signing: AWS Console, YouTube (SAPISIDHASH)
- Pagination: Sentry (Link header), Pinterest (bookmark), Reddit (after)
- Extraction: Airbnb (deferred state), Yelp (react_root_props), TikTok (__UNIVERSAL_DATA__)
- Google: Calendar, Drive, Analytics (gapi proxy)
