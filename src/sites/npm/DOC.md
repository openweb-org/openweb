# npm

## Overview
JavaScript package registry at registry.npmjs.org. Public REST API for package search, metadata, versions, and download statistics.

## Workflows

### Find a package
1. `searchPackages(text)` → browse results → pick package `name`
2. `getPackage(package)` → full metadata, description, dependencies, license

### Check package health
1. `getPackage(package)` → latest version, maintainers, repository
2. `getDownloads(package)` → weekly download count

### Compare versions
1. `getPackage(package)` → `versions` map with all version metadata and `time` map with publish dates

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPackages | find packages by keyword | text | name, version, description, score | entry point, paginated via from/size |
| getPackage | full package metadata | package ← searchPackages | name, description, versions, dependencies, license | full document, can be large |
| getVersions | latest version details | package ← searchPackages | name, version, dependencies, dist | abbreviated metadata for latest |
| getDownloads | weekly download stats | package ← searchPackages | downloads, start, end | uses api.npmjs.org host |

## Quick Start

```bash
# Search for packages
openweb npm exec searchPackages '{"text": "express"}'

# Get package details
openweb npm exec getPackage '{"package": "react"}'

# Get latest version info
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
- All responses are JSON, no HTML rendering needed
- Large packages (e.g. lodash) return big version maps; no server-side trimming available

## Auth
No auth required. All operations are public read-only.

## Transport
- `node` — direct HTTP works, no browser needed
- No bot detection, no CORS restrictions, no rate limiting for reasonable usage
- Downloads endpoint uses a different host (api.npmjs.org), configured via operation-level server override

## Known Issues
- Scoped packages (e.g. @babel/core) require URL encoding: `@babel%2Fcore`
- `getPackage` response can be very large for packages with many versions (hundreds of version entries)
- The `getVersions` operation hits `/{package}/latest` which returns the latest version document, not a version list — use `getPackage` for the full version map with timestamps
