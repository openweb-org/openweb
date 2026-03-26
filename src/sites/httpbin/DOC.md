# httpbin

## Overview
HTTP testing service — returns caller metadata. No auth, no state.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getIp | caller IP | GET /ip | |
| getUserAgent | caller UA string | GET /user-agent | |
| getHeaders | caller headers | GET /headers | |
| getUuid | generate UUID | GET /uuid | |

## Transport
- `node` — direct HTTP, no browser needed
