# npm

## Overview
JavaScript package registry at registry.npmjs.org. Public REST API for package search, metadata, versions, and download statistics.

## Workflows

### Find a package
1. `searchPackages(text)` → browse `objects[].package` → pick `name`
2. `getPackage(package=name)` → description, dist-tags.latest, dependencies, license

### Check package health
1. `getPackage(package)` → `dist-tags.latest`, maintainers, repository
2. `getDownloads(package)` → downloads, start, end

### Compare versions
1. `getPackage(package)` → `versions` map (version metadata per release), `time` map (publish date per version)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPackages | find packages by keyword | text | name, version, description, score | entry point, paginated via from/size |
| getPackage | full package metadata | package <- searchPackages.name | name, description, versions, dependencies, license | full document, can be large |
| getVersions | latest version details | package <- searchPackages.name | name, version, dependencies, dist | abbreviated metadata for latest |
| getDownloads | weekly download stats | package <- searchPackages.name | downloads, start, end | uses api.npmjs.org host |

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
