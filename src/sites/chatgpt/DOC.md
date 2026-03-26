# ChatGPT

## Overview
ChatGPT backend API — OpenAI's conversational AI interface.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getProfile | authenticated user profile | GET /me | |
| listConversations | recent conversations | GET /conversations | cursor pagination |
| getConversation | full conversation with message tree | GET /conversation/{id} | mapping contains all messages as a tree |
| searchConversations | search past conversations by keyword | GET /conversations/search | returns snippets with matched text |
| sendMessage | send message, get streaming response | POST /f/conversation | ⚠️ WRITE — SSE response (text/event-stream) |

## API Architecture
- Backend API at `chatgpt.com/backend-api/`
- Conversation detail returns a `mapping` object: a tree of nodes keyed by UUID, each with `parent`, `children`, and `message` fields. Follow `current_node` to find the latest message, then walk `parent` pointers to reconstruct the thread.
- Search returns `items` with `payload.snippet` containing the matched message text.
- Send message (`POST /f/conversation`) returns Server-Sent Events (SSE), **not** WebSocket. The response stream contains `delta` events with incremental message content.
- Cursor pagination on listConversations: response `cursor` → request `cursor` param
- Search pagination uses numeric offset: response `cursor` (integer) → request `cursor` param

## Auth
- `exchange_chain` — single step:
  1. GET `chatgpt.com/api/auth/session` → extract `accessToken`
  - Injected as `Authorization: Bearer <token>`
- Session cookies must include valid `cf_clearance` (Cloudflare)

## Transport
- `node` — direct HTTP (with session cookies forwarded via CDP browser context)

## Known Issues
- UA header must match the browser session's UA or Cloudflare rejects the request
- CLI `verify` command hits exit code 13 (top-level await issue in tsx); operations verified manually via direct HTTP calls
- WebSocket connections visible in traffic are for notifications/presence, not chat messaging
