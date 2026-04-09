# Trello

## Overview

Kanban board task management. Productivity/collaboration archetype.

## Workflows

### Browse boards and cards

1. `getBoards` → `boards[].id`
2. `getBoard boardId` ← boards[].id → full board with `lists[]` and `cards[]`
3. `getCards listId` ← lists[].id → cards in a specific list

### Create a card

1. `getBoards` → pick a board
2. `getLists boardId` ← boards[].id → `lists[].id`
3. `createCard idList, name` ← lists[].id → new card

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getBoards | read | — (entry point) | boards[].id, name, url | Lists user's open boards |
| getBoard | read | boardId ← getBoards | lists[], cards[] with labels/due | Full board snapshot |
| getLists | read | boardId ← getBoards | lists[].id, name, pos | Open lists only |
| getCards | read | listId ← getLists/getBoard | cards[].id, name, due, labels | Cards in one list |
| createCard | write | idList ← getLists, name | card.id, url | Creates a card (reversible) |

## Quick Start

```bash
# List your boards
openweb trello exec getBoards '{}'

# Get a board with all lists and cards
openweb trello exec getBoard '{"boardId": "BOARD_ID"}'

# Get cards in a list
openweb trello exec getCards '{"listId": "LIST_ID"}'

# Create a card
openweb trello exec createCard '{"idList": "LIST_ID", "name": "My task", "desc": "Details here"}'
```

## Site Internals

- **API Architecture:** REST API at `api.trello.com/1/`. All operations are standard REST endpoints with JSON responses.
- **Auth:** Cookie session from trello.com webapp. Cookies are set on `.trello.com` and shared with `api.trello.com`. Cookies extracted automatically via page transport.
- **Transport:** `page` — browser context required to forward session cookies cross-origin to `api.trello.com`. All operations use an adapter that calls the API via `pageFetch`.
- **Adapter:** `trello-api` — translates operation params to Trello REST API calls. Uses `helpers.pageFetch()` for browser-context requests with cookie auth.

## Known Issues

- All operations require authentication. Run `openweb login trello` first.
- Board/list/card IDs are opaque strings — always obtain from a prior operation.
- createCard is a write operation; it creates real cards in the user's workspace.
