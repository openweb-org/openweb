# X (Twitter)

## Overview
Social media and microblogging platform. Archetype: Social Media.

## Target Intents

- [ ] Get home timeline (feed)
- [ ] Search posts by keyword
- [ ] Get user profile by screen name
- [ ] Get a user's tweets
- [ ] Like a tweet (write, SAFE)

## Auth
- **Auth:** cookie_session
- **CSRF:** cookie_to_header (`ct0` cookie -> `x-csrf-token` header), scope: ALL methods (including GET)
- Must log in before capture

## Transport
- **Expected:** page (X uses TLS fingerprinting; node transport likely blocked)

## Known Issues
- CSRF required on ALL methods including GET (unusual)
- TLS fingerprinting blocks non-browser requests
- GraphQL-heavy API with persisted query IDs in URL paths
