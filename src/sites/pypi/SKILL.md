# PyPI

## Overview
Python Package Index — the official repository for Python packages. Public JSON API, no auth required.

## Workflows

### Look up a package
1. `getPackage(package)` → name, summary, version, author, license, dependencies

### Check a specific version
1. `getPackage(package)` → `version` (latest)
2. `getPackageVersion(package, version)` → metadata for that version

### List all versions of a package
1. `getReleases(package)` → `versions[]`

### Compare versions
1. `getReleases(package)` → `versions[]`
2. `getPackageVersion(package, version)` → metadata for version A
3. `getPackageVersion(package, version)` → metadata for version B

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getPackage | get package metadata | package name | name, summary, version, author, license, requires_dist | entry point |
| getPackageVersion | version-specific metadata | package, version <- getReleases / getPackage | name, version, requires_python, requires_dist, upload_time | |
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
