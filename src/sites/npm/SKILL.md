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
