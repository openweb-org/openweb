# ChatGPT

## Overview
ChatGPT backend API — OpenAI's conversational AI interface.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getProfile | authenticated user profile | GET /me | |
| listConversations | recent conversations | GET /conversations | cursor pagination |

## API Architecture
- Backend API at `chatgpt.com/backend-api/`
- Cursor pagination on listConversations: response `cursor` → request `cursor` param
- Requires matching `User-Agent` header — Cloudflare `cf_clearance` cookie is bound to the UA string used during browser session

## Auth
- `exchange_chain` — single step:
  1. GET `chatgpt.com/api/auth/session` → extract `accessToken`
  - Injected as `Authorization: Bearer <token>`
- Session cookies must include valid `cf_clearance` (Cloudflare)

## Transport
- `node` — direct HTTP (with session cookies forwarded)

## Known Issues
- UA header must match the browser session's UA or Cloudflare rejects the request
