# npm

## Overview
npm registry — JavaScript package registry. Public REST API.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getPackage | package metadata by name | GET /{package} | returns versions, dist-tags, maintainers, repo |
| searchPackages | search packages by text | GET /-/v1/search?text= | returns scored results with metadata |

## API Architecture
- Public REST API at `registry.npmjs.org`
- Standard JSON responses, no authentication needed
- Search endpoint uses `/-/v1/search` path prefix

## Auth
- None required

## Transport
- `node` — direct HTTP to registry API
