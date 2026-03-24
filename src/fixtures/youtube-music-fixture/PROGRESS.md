# YouTube Music Fixture Progress

## 2026-03-24: Initial creation

- Captured traffic from 13 page navigations: home, search (x2), watch (x2), album (x2), playlist, artist (x2), explore, charts, moods & genres, new releases
- 77 InnerTube API calls captured across endpoints: browse, search, player, next, music/get_search_suggestions, log_event, account_menu, att/get
- YouTube Music SPA loads most data via SSR during full page navigation; InnerTube API calls happen during SPA transitions
- Built L3 adapter with direct `page.evaluate(fetch())` calls to InnerTube API (same pattern as Twitch GraphQL adapter)
- 10 operations implemented via InnerTube endpoints (search, browse, player, next, get_search_suggestions)
- All operations target public (no-auth) data
- Transport: `page` (browser fetch required for Google bot detection)
- API key: `AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30` (public, extracted from ytcfg)
- Client: `WEB_REMIX` / version `1.20260318.00.00`
