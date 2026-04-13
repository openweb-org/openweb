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
2. `listConversations` → pick conversation → `conversationId`
3. `getConversation(conversationId)` → get `current_node` → `parentMessageId`
4. `sendMessage(conversationId, parentMessageId, model, text)` → SSE stream

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | authenticated user info | — | id, name, email | entry point |
| listConversations | recent conversations | limit?, cursor? | items[].id, title, cursor | paginated (cursor) |
| getConversation | full conversation detail | conversationId ← listConversations | mapping (message tree), current_node | tree structure |
| searchConversations | search past conversations | query | items[].conversation_id, snippet | paginated (offset cursor) |
| getModels | available models | — | models[].slug, title | entry point |
| sendMessage | send message, get response | model ← getModels, conversationId ← listConversations, parentMessageId ← getConversation | SSE delta stream | WRITE, SSE |

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
```
