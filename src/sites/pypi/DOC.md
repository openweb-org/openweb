# PyPI

## Overview
Python Package Index — the official repository for Python packages. Public JSON API, no auth required.

## Workflows

### Look up a package
1. `getPackage(package)` → name, summary, version, author, license, dependencies

### Check a specific version
1. `getPackage(package)` → find latest version
2. `getPackageVersion(package, version)` → metadata for that version

### List all versions of a package
1. `getReleases(package)` → all version strings + download files

### Compare versions
1. `getReleases(package)` → pick versions from the list
2. `getPackageVersion(package, version)` → metadata for version A
3. `getPackageVersion(package, version)` → metadata for version B

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getPackage | get package metadata | package name | name, summary, version, author, license, requires_dist | entry point |
| getPackageVersion | version-specific metadata | package, version ← getReleases | name, version, requires_python, requires_dist | |
| getReleases | list all versions | package name | versions[], files[] | entry point |

## Quick Start

```bash
# Get package metadata
openweb pypi exec getPackage '{"package": "requests"}'

# Get specific version info
openweb pypi exec getPackageVersion '{"package": "requests", "version": "2.31.0"}'

# List all released versions
openweb pypi exec getReleases '{"package": "flask"}'
```

---

## Site Internals

## API Architecture
- Public JSON API at `pypi.org/pypi/{package}/json`
- Simple API at `pypi.org/simple/{package}/` (with JSON accept header)
- No search API — PyPI deprecated XML-RPC search, HTML search has bot detection
- Package names are case-insensitive and normalize hyphens/underscores

## Auth
No auth required. All operations are public read-only.

## Transport
- `node` — direct HTTP, no browser needed
- All endpoints return JSON natively
- getReleases requires `Accept: application/vnd.pypi.simple.v1+json` header

## Known Issues
- No programmatic search API — use getPackage with known package names
- `author` field is often null on newer packages (metadata moved to `author_email`)
- `license` may be null; check `classifiers` for license trove classifiers as fallback
- getReleases `files` array can be very large for packages with many versions
