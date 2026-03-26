# Microsoft Word

## Overview
Microsoft Graph profile access via Word Online's MSAL token cache.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getProfile | signed-in user profile | GET graph.microsoft.com/v1.0/me | uses Microsoft Graph API |

## API Architecture
- The actual API call goes to `graph.microsoft.com/v1.0/me` — not to `word.cloud.microsoft`
- Word Online stores MSAL tokens in sessionStorage; this site package reuses them to call Microsoft Graph

## Auth
- `sessionStorage_msal` — reads MSAL token cache from sessionStorage
- Key pattern: `msal.token.keys.*`, filtered by `user.read` scope
- Extracts `secret` field (the access token)
- Injected as `Authorization: Bearer <token>`

## Transport
- `node` — direct HTTP to Graph API (with extracted token)
