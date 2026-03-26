# JSONPlaceholder

## Overview
JSONPlaceholder — free fake REST API for testing. No auth, no state.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| listPosts | list posts | GET /posts | `_limit` param |
| getPost | get post by ID | GET /posts/{id} | |
| createPost | create a post | POST /posts | write op, returns 201 |

## Transport
- `node` — direct HTTP, no browser needed
