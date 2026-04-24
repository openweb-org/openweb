# npm

## Overview
JavaScript package registry at registry.npmjs.org. Public REST API for package search, metadata, versions, and download statistics.

## Workflows

### Find a package
1. `searchPackages(text)` → browse results → pick package `name`
2. `getPackage(package)` → summary with description, dependencies, license

### Check package health
1. `getPackage(package)` → latest version, maintainers, repository, timestamps
2. `getDownloads(package)` → weekly download count
3. `getVersions(package)` → full release history with dates

### Compare versions
1. `getVersions(package)` → all versions sorted newest-first with publish dates
2. `getPackage(package)` → latest version dependencies and dist-tags

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPackages | find packages by keyword | text | name, version, description, score, downloads | entry point, paginated via from/size |
| getPackage | package summary | package ← searchPackages | name, description, latest deps, license, maintainers | adapter-unwrapped from full registry doc |
| getVersions | version history with dates | package ← searchPackages | versions array [{version, date}], versionCount | sorted newest-first |
| getDownloads | weekly download stats | package ← searchPackages | downloads, start, end | uses api.npmjs.org host |

## Quick Start

```bash
# Search for packages
openweb npm exec searchPackages '{"text": "express"}'

# Get package summary
openweb npm exec getPackage '{"package": "react"}'

# Get version history
openweb npm exec getVersions '{"package": "express"}'

# Get download stats
openweb npm exec getDownloads '{"package": "lodash"}'
```

---

## Site Internals

## API Architecture
- Pure REST JSON API, two hosts:
  - `registry.npmjs.org` — package metadata, search, versions
  - `api.npmjs.org` — download statistics
- `getPackage` and `getVersions` use an adapter to extract useful fields from the full registry document (which can be MB-sized for packages with many versions)

## Auth
No auth required. All operations are public read-only.

## Transport
- `node` — direct HTTP, no browser needed
- `getPackage` and `getVersions` routed through adapter (`adapters/npm.ts`)
- `searchPackages` and `getDownloads` are direct HTTP calls
- No bot detection, no CORS restrictions, no rate limiting for reasonable usage
- Downloads endpoint uses a different host (api.npmjs.org), configured via operation-level server override

## Known Issues
- Scoped packages (e.g. @babel/core) require URL encoding: `@babel%2Fcore`
- `searchPackages` uses `text` as the query parameter name (matches npm upstream API)
