# npm

## Overview
npm registry — JavaScript package registry. Public REST APIs across two domains.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getPackage | full package metadata by name | GET /{package} | returns versions, dist-tags, maintainers, readme, repo |
| searchPackages | search packages by text | GET /-/v1/search?text= | returns scored results with metadata |
| getPackageVersion | metadata for a specific version | GET /{package}/{version} | returns deps, dist, engines, scripts |
| getDistTags | dist-tags for a package | GET /-/package/{package}/dist-tags | returns latest, next, etc. |
| getDownloadStats | total downloads over a period | GET /downloads/point/{period}/{package} | api.npmjs.org; period: last-day/week/month/year |
| getDownloadRange | daily download counts over a range | GET /downloads/range/{period}/{package} | api.npmjs.org; period or date range |

## API Architecture
- Two domains: `registry.npmjs.org` (package data) and `api.npmjs.org` (download stats)
- Standard JSON responses, no authentication needed
- Search uses `/-/v1/search` prefix on the registry domain
- Scoped packages need URL encoding (`@scope/name` → `%40scope%2Fname`)

## Auth
- None required

## Transport
- `node` — direct HTTP; both APIs are public with no bot detection

## Known Issues
- `getPackage` returns the full document including all versions — can be very large (800KB+ for popular packages)
- Download stats API has a separate rate limit from the registry
