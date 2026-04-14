# Docker Hub

## Overview
Container image registry. Public REST API for searching and browsing Docker images, tags, and metadata.

## Workflows

### Find a container image
1. `searchImages(query)` → `repo_name` (format: namespace/name)
2. `getImage(namespace, name)` → full description, stars, pull count

### Check available versions/tags
1. `searchImages(query)` → `repo_name` → split into `namespace`, `name`
2. `getTags(namespace, name)` → tags with size, architecture, last updated

### Inspect an official image
1. `getImage("library", name)` → image detail (official images use "library" namespace)
2. `getTags("library", name)` → available tags

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchImages | find container images | query | repo_name, short_description, star_count, pull_count, is_official | entry point, paginated |
| getImage | image details | namespace, name <- searchImages | description, full_description, star_count, pull_count, last_updated | use "library" for official images |
| getTags | list image tags/versions | namespace, name <- searchImages | name, full_size, images[].architecture, last_updated | paginated, orderable |

## Quick Start

```bash
# Search for images
openweb docker-hub exec searchImages '{"query":"nginx"}'

# Get details for an official image (namespace = "library")
openweb docker-hub exec getImage '{"namespace":"library","name":"nginx"}'

# Get details for a user image
openweb docker-hub exec getImage '{"namespace":"bitnami","name":"nginx"}'

# List tags for an image
openweb docker-hub exec getTags '{"namespace":"library","name":"python","page_size":10}'

# List tags sorted by most recently updated
openweb docker-hub exec getTags '{"namespace":"library","name":"node","ordering":"-last_updated","page_size":25}'
```

## Known Issues
- Official images require `library` as the namespace parameter.
- Search results use `repo_name` which may be `library/nginx` or `user/repo` format.
- Tag `full_size` may be 0 for multi-arch manifests; check `images[].size` for per-architecture sizes.
- Pagination defaults vary: search defaults to 25, tags defaults to 10.
