# Coinbase Exchange

## Overview
Coinbase Exchange WebSocket feed — real-time public market data. WS-only, no REST.

## Operations
| Operation | Action | Pattern | Notes |
|-----------|--------|---------|-------|
| ws_send_subscribe | send | subscribe | subscribe to channels with product_ids |
| ws_send_unsubscribe | send | subscribe | unsubscribe from channels |
| ws_recv_ticker_BTC_USD | receive | stream | BTC-USD ticker updates |
| ws_recv_ticker_ETH_USD | receive | stream | ETH-USD ticker updates |

## API Architecture
- **WS-only** — no REST endpoints, all data via WebSocket
- Single connection to `wss://ws-feed.exchange.coinbase.com/`
- Subscribe by sending `{"type": "subscribe", "channels": [{"name": "ticker", "product_ids": ["BTC-USD"]}]}`
- Discriminator: sent messages keyed by `type`, received by `type` + `product_id` sub-field on `ticker` messages
- Ticker payloads include: price, 24h OHLC, volume, bid/ask, trade info — all as strings (not numbers)

## Auth
None — fully public market data feed.

## Transport
- `node` — direct WebSocket, no browser needed

## Known Issues
- All operations unverified (verified: false)
- Only BTC-USD and ETH-USD tickers are spec'd — more product_ids available at runtime
