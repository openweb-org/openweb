# PyPI

## Overview
Python Package Index — the official repository for Python packages. Public JSON API, no auth required.

## Workflows

### Look up a package
1. `getPackage(package)` → name, summary, version, author, license, dependencies

### Check a specific version
1. `getPackage(package)` → find latest version
2. `getPackageVersion(package, version)` → metadata + upload_time for that version

### List all versions of a package
1. `getReleases(package)` → chronological version list

### Compare versions
1. `getReleases(package)` → pick versions from the list
2. `getPackageVersion(package, version)` → metadata for version A
3. `getPackageVersion(package, version)` → metadata for version B

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getPackage | get package metadata | package name | name, summary, version, author, license, requires_dist | entry point |
| getPackageVersion | version-specific metadata | package, version ← getReleases | name, version, requires_python, requires_dist, upload_time | |
| getReleases | list all versions | package name | versions[] | entry point |

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
- Adapter curates response fields (strips bloated description, deprecated downloads, download URLs/hashes)

## Known Issues
- No programmatic search API — use getPackage with known package names
- `author` field is often null on newer packages (metadata moved to `author_email`)
- `license` may be full text on older packages; adapter extracts the first line as identifier
- `home_page` may be null; adapter resolves from `project_urls` when possible
