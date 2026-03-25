# Fidelity

## Overview
Financial services platform. Stock quotes, company profiles, market news, analyst ratings, sector data, and mutual fund research via Fidelity's internal APIs. Focused on public market data pages that don't require login.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getStockQuote | real-time stock prices | POST /prgw/digital/research/api/quote | price, volume, PE, market cap, 52w range, dividends, short interest |
| getCompanyProfile | company details | POST /prgw/digital/research/api/company-profile | sector, industry, employees, address, website, description |
| getNewsHeadlines | market/stock news | POST /prgw/digital/research/api/news-headlines | headlines with provider, date, impact rating, photos |
| getMarketIndices | major market indices | POST /prgw/digital/research/api/market-bar | S&P 500, DJIA, NASDAQ current values and changes |
| getIndexQuotes | global indices/currencies | POST /prgw/digital/research/api/sector-research/index-quote | international indices and forex rates |
| getResearchData | analyst ratings/holdings | POST /prgw/digital/research/api/pass-through | proxy for analyticRatings, portfolioCompositions, commentary |
| getCompanyLogo | company logo URL | POST /prgw/digital/research/api/company-logo | logo image for display |
| getMutualFundPerformance | fund returns | GET /mutual-funds/api/v1/investments/{cusip}/header | YTD, 1/3/5/10yr annual returns (fundresearch.fidelity.com) |
| getMutualFundSummary | fund composition | GET /mutual-funds/api/v1/investments/{cusip}/summary | composition, fees, ratings (fundresearch.fidelity.com) |
| getFundPicks | recommended funds | GET /mutual-funds/api/v1/investments/fundpicks | Fidelity fund picks by asset class/category (fundresearch.fidelity.com) |

## API Architecture
- **Primary host**: `digital.fidelity.com` — BFF (Backend-For-Frontend) POST APIs at `/prgw/digital/research/api/*`
- **Fund research host**: `fundresearch.fidelity.com` — GET APIs at `/mutual-funds/api/v1/*`
- Internal APIs used by Fidelity's Angular frontend — no official documentation
- POST endpoints use JSON request bodies with CSRF tokens (handled by page transport)
- `pass-through` endpoint is a proxy: accepts `apiTokenName` to select data type (analyticRatings, portfolioCompositions, commentary, companyProfileSummary)

## Auth
- No login required for the 10 included operations
- `requires_auth: false`
- POST endpoints on digital.fidelity.com use CSRF tokens (X-CSRF-TOKEN header) — handled automatically by `page` transport
- Account/trading endpoints require full auth (not included)

## Transport
- **POST endpoints (digital.fidelity.com)**: `transport: page` — browser fetch required for CSRF tokens and bot detection
- **GET endpoints (fundresearch.fidelity.com)**: `transport: node` — direct HTTP fetch works, verified PASS
- Bot detection (PerimeterX) active on digital.fidelity.com — node transport blocked

## Extraction
- All operations return JSON directly — no SSR extraction needed
- Numeric values returned as strings (prices, percentages) — parse as needed

## Known Issues
- **CSRF tokens**: POST endpoints require valid X-CSRF-TOKEN header from browser cookies. Page transport handles this automatically.
- **Pass-through endpoint**: Response shape varies by `apiTokenName` — no single consistent schema
- **Fund CUSIPs**: Mutual fund endpoints use CUSIP identifiers. Common ones: FXAIX=315911750, FBGRX=316071109
- **News topic codes**: Use "FI/Top.Investing.RT" for top investing news, or ticker symbols for stock-specific news
