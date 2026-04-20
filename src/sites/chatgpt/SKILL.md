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
1. `sendMessage({ prompt })` → SPA-driven send → `{ conversation_id, response_text }`
2. `getConversation(conversation_id)` → full message tree once the reply finishes

`sendMessage` no longer needs `model` / `parentMessageId` — the chatgpt-web
adapter drives the live SPA, so the page picks the active model and threads
the new turn for you. Pass `prompt` only.

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | authenticated user info | — | id, name, email | entry point |
| listConversations | recent conversations | limit?, cursor? | items[].id, title, cursor | paginated (cursor) |
| getConversation | full conversation detail | conversationId ← listConversations \| sendMessage | mapping (message tree), current_node | tree structure |
| searchConversations | search past conversations | query | items[].conversation_id, snippet | paginated (offset cursor) |
| getModels | available models | — | models[].slug, title | entry point |
| sendMessage | send message, get reply | prompt | conversation_id, response_text, sse_event_count | WRITE; SPA-driven adapter |

## Quick Start

```bash
# Get user profile
openweb chatgpt exec getProfile '{}'

# List recent conversations
openweb chatgpt exec listConversations '{"limit": 10}'

# Get a conversation
openweb chatgpt exec getConversation '{"conversationId": "<id>"}'

# Search conversations
openweb chatgpt exec searchConversations '{"query": "python"}'

# Get available models
openweb chatgpt exec getModels '{}'

# Send a message (SPA-driven)
openweb chatgpt exec sendMessage '{"prompt": "Summarize the OpenWeb readme."}'
```

## Known Limitations

- **`sendMessage.response_text` may come back empty.** Playwright's
  `Response.text()` resolves before the SSE stream finishes, so the adapter
  often captures only the opening frames. `conversation_id` is reliable —
  follow up with `getConversation` to read the assembled reply. Fix path:
  switch the adapter to a CDP `Network.dataReceived` listener that buffers
  frames until the stream closes.
- **`sendMessage` requires a managed browser session.** Runs through the
  live chatgpt.com SPA so the page can solve OpenAI's Sentinel
  chat-requirements + SHA3-512 proof-of-work challenge. There is no Node
  fallback. See `DOC.md` § Adapter pattern for the full rationale.
- **Read ops still use Node transport** (`exchange_chain` → Bearer). Only
  `sendMessage` is adapter-driven.
