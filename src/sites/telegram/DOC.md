# Telegram Web A

## Overview
Telegram Web A — messaging platform. L3 adapter-based extraction from teact global state.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getDialogs | list chats/dialogs | GET /internal/dialogs | adapter: telegram-protocol |
| getMe | current user info | GET /internal/me | adapter: telegram-protocol |
| getMessages | messages from a chat | GET /internal/messages | chatId param required |

## API Architecture
- **No REST API** — all operations use `telegram-protocol` adapter
- `/internal/*` paths are virtual — adapter reads from Telegram Web A's teact global state
- Chat IDs are numeric strings (e.g. `-1001625429257`)

## Auth
- Requires Telegram Web A to be logged in (session in browser)
- No explicit auth config in spec — adapter reads from app's in-memory state

## Transport
- `page` — requires Telegram Web A (`web.telegram.org/a/`) loaded in browser
