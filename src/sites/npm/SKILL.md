# npm

## Overview
JavaScript package registry at registry.npmjs.org. Public REST API for package search, metadata, versions, and download statistics.

## Workflows

### Find a package
1. `searchPackages(text)` → browse `objects[].package` → pick `name`
2. `getPackage(package=name)` → description, latest version, dependencies, license

### Check package health
1. `getPackage(package)` → latest version, maintainers, repository, timestamps
2. `getDownloads(package)` → downloads, start, end
3. `getVersions(package)` → full release history with dates

### Compare versions
1. `getVersions(package)` → all versions sorted newest-first with publish dates
2. `getPackage(package)` → latest version dependencies and dist-tags

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPackages | find packages by keyword | text | name, version, description, score, downloads | entry point, paginated via from/size |
| getPackage | package summary | package <- searchPackages.name | name, description, latest deps, license, maintainers | adapter-unwrapped summary |
| getVersions | version history with dates | package <- searchPackages.name | versions [{version, date}], versionCount | sorted newest-first |
| getDownloads | weekly download stats | package <- searchPackages.name | downloads, start, end | uses api.npmjs.org host |

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
