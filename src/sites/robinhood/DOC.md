# Robinhood

## Overview
Stock trading platform. Stock quotes, crypto prices, fundamentals, analyst ratings, earnings data, and market hours via Robinhood's internal APIs. Focused on public market data pages that don't require login.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getInstruments | look up stocks by ID | GET /instruments/?ids={ids} | returns symbol, name, tradability, market info |
| getStockQuotes | real-time stock prices | GET /marketdata/quotes/?instruments={urls} | bid, ask, last trade, previous close |
| getStockFundamentals | stock fundamentals | GET /marketdata/fundamentals/{id}/ | market cap, PE, dividend yield, 52w range, company info |
| getStockEarnings | earnings history | GET /marketdata/earnings/?instrument={url} | EPS estimates vs actuals, report dates |
| getAnalystRatings | analyst ratings | GET /discovery/ratings/{id}/ | buy/hold/sell summary + individual ratings |
| getStockNews | stock news feed | GET /feed/midlands/instrument/{id}/ | articles with title, source, date, preview (dora.robinhood.com) |
| getCryptoQuote | crypto price quote | GET /marketdata/forex/quotes/{pair_id}/ | bid, ask, mark, OHLC, volume |
| getCryptoFundamentals | crypto fundamentals | GET /marketdata/forex/fundamentals/{pair_id}/ | market cap, supply, 52w range, description |
| getCryptoHistoricals | crypto chart data | GET /marketdata/forex/historicals/{pair_id}/ | OHLCV candlestick data with configurable interval/span |
| getMarketHours | market schedule | GET /markets/{mic}/hours/{date}/ | open/close times, extended hours, holiday status |
| getDiscoveryLists | curated stock lists | GET /discovery/lists/?object_id={id} | collection metadata (popular, tech, crypto) |

## API Architecture
- **Primary API host**: `api.robinhood.com` — serves most endpoints
- **News host**: `dora.robinhood.com` — serves news/feed endpoints
- Internal APIs used by robinhood.com frontend — no official documentation
- UUID-based identifiers: stocks use instrument UUIDs, crypto uses currency pair UUIDs
- Instruments endpoint acts as a lookup: provide UUIDs → get symbols, names, metadata

## Auth
- No auth needed for the 11 included operations
- `requires_auth: false`
- Trading/account endpoints require OAuth bearer tokens (not included)

## Transport
- `transport: node` — direct HTTP fetch from Node.js
- No bot detection on api.robinhood.com API endpoints
- Public market data endpoints respond without cookies or browser state

## Extraction
- All operations return JSON directly — no SSR extraction needed
- Numeric values are returned as strings (e.g. prices, ratios) — parse as needed

## Known Issues
- **UUID-based identifiers**: Most endpoints use UUIDs instead of ticker symbols. Use `getInstruments` with `ids` param to resolve UUIDs to symbols, or get instrument IDs from page URLs
- **Instrument URL format**: Some endpoints (quotes, earnings) expect full instrument URLs like `https://api.robinhood.com/instruments/{id}/` rather than bare UUIDs
- **Nullable earnings fields**: `eps.actual` and `call` can be null for future quarters
- **Crypto pair IDs**: Known IDs — BTC: `3d961844-d360-45fc-989b-f6fca761d511`, ETH: `76637d50-c702-4ed1-bcb5-5b0732a81f48`, DOGE: `1ef78e1b-049b-4f12-90e5-555dcf2fe204`
