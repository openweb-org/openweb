# ChatGPT

## Overview
ChatGPT backend API — OpenAI's conversational AI interface. Content platform archetype.

## Workflows

### Browse conversations
1. `listConversations` → pick conversation → `conversationId`
2. `getConversation(conversationId)` → full message tree

### Search and read
1. `searchConversations(query)` → results with `conversationId`
2. `getConversation(conversationId)` → full message tree

### Send a message
1. `getModels` → pick model → `modelSlug`
2. `listConversations` → pick conversation → `conversationId`, `currentNode`
3. `sendMessage(conversationId, parentMessageId, model, text)` → SSE stream

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | authenticated user info | — | id, name, email | entry point |
| listConversations | recent conversations | limit?, cursor? | items[].id, title, cursor | paginated (cursor) |
| getConversation | full conversation detail | conversationId <- listConversations | mapping (message tree), current_node | tree structure |
| searchConversations | search past conversations | query | items[].conversation_id, snippet | paginated (offset cursor) |
| getModels | available models | — | models[].slug, title | entry point |
| sendMessage | send message, get response | model <- getModels, parentMessageId, text | SSE delta stream | WRITE, SSE response |

## Quick Start

```bash
# List recent conversations
openweb chatgpt exec listConversations '{"limit": 10}'

# Get a conversation
openweb chatgpt exec getConversation '{"conversationId": "<id>"}'

# Search conversations
openweb chatgpt exec searchConversations '{"query": "python"}'

# Get available models
openweb chatgpt exec getModels '{}'
```

---

## Site Internals

## API Architecture
- Backend API at `chatgpt.com/backend-api/`
- Conversation detail returns a `mapping` object: tree of nodes keyed by UUID, each with `parent`, `children`, `message` fields
- Send message returns SSE (text/event-stream), not WebSocket
- Cursor pagination on listConversations; offset pagination on search

## Auth
- `exchange_chain` — single step:
  1. GET `chatgpt.com/api/auth/session` → extract `accessToken`
  2. Inject as `Authorization: Bearer <token>`
- Session cookies must include valid `cf_clearance` (Cloudflare)
- UA header must match browser session UA

## Transport
- `node` — direct HTTP with session cookies forwarded via CDP

## Known Issues
- UA header mismatch causes Cloudflare rejection
- ssrfValidator may block some backend-api URLs (known bug)
- WebSocket connections in traffic are notifications, not chat
