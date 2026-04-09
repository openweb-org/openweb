# Trello — Progress

## 2026-04-09 — Initial package

- Added 5 operations: getBoards, getBoard, getLists, getCards, createCard
- Adapter-based package using `trello-api` adapter for cross-origin REST API calls
- Auth: cookie_session via page transport
- Transport: page (required for cookie forwarding to api.trello.com)
