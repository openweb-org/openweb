# Twitch Fixture Progress

## 2026-03-24: Initial creation

- Captured traffic from 15 page navigations covering homepage, directory, categories, search, channels, about, schedule, videos, clips
- 514 HAR entries, 138 unique GraphQL operations identified
- Compiler auto-compile produced only 3 operations (ads endpoints) because Twitch uses POST-only GraphQL — manually crafted L3 adapter
- 10 operations implemented via persisted query hashes
- All operations target public (no-auth) data
- Transport: `page` (browser fetch required for Client-ID header and bot detection)
