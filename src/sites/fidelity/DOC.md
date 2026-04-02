# Fidelity

## Overview
Financial services platform. Stock quotes, market indices, mutual fund research, company profiles, and news from Fidelity Investments.

## Workflows

### Look up a stock
1. `getQuote(symbol)` → price, volume, PE, market cap, 52-week range
2. `getCompanyProfile(symbols)` → sector, industry, employees, description
3. `getNewsHeadlines(symbol)` → recent news for the stock

### Research mutual funds
1. `listAssetClasses` → get asset class and category codes
2. `searchFunds(searchFilter)` → browse/filter funds by criteria
3. `getFundPicks(mstarAssetClassCd, mstarCtgyCd)` → Fidelity-recommended funds
4. `getFundPerformance(cusip)` → annual returns (YTD, 1/3/5/10yr)
5. `getFundSummary(cusip)` → composition, ratings, fees

### Market overview
1. `getMarketSummary` → S&P 500, DJIA, NASDAQ current values
2. `getIndexQuotes(symbol)` → global indices, currencies

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getQuote | real-time stock price | symbol | lastPrice, netChgToday, pctChgToday, volume, marketCap | page transport |
| getMarketSummary | major US indices | — | quotes[].label, lastPrice, netChgToday | page transport |
| getCompanyProfile | company details | symbols[] | companyName, sector, industry, employeeCount | page transport |
| getNewsHeadlines | stock/market news | symbol | headlines[].text, provider, resDate, impactRating | page transport |
| getIndexQuotes | global indices/forex | symbol (comma-separated) | quotes[].name, pctChgToday | page transport |
| getResearchData | analyst ratings/holdings | apiTokenName, params | varies by apiTokenName | page transport, proxy endpoint |
| getCompanyLogo | company logo URL | fvSymbols | logo URL | page transport |
| searchFunds | browse/filter mutual funds | searchFilter, pageNumber, noOfRowsPerPage | funds[].fundInformation, mstarOverallRating | entry point for fund research |
| listAssetClasses | asset class/category codes | — | code, description, categories[] | entry point for screening |
| listFundFamilies | fund family names | — | code, description | |
| getFundPicks | recommended funds | mstarAssetClassCd, mstarCtgyCd | fundPicks.funds[].ticker, legalName, mstarOverallRating | |
| getFundPerformance | fund annual returns | cusip ← searchFunds/getFundPicks | performanceAverageAnnualReturns | CUSIP from fund search |
| getFundSummary | fund composition/fees | cusip ← searchFunds/getFundPicks | compositionByInstrument, feeExpense, mstarRating | CUSIP from fund search |

## Quick Start

```bash
# Get a stock quote
openweb fidelity exec getQuote '{"symbol":"AAPL"}'

# Get market summary
openweb fidelity exec getMarketSummary '{"supportCrypto":"N"}'

# Search mutual funds (all US equity funds)
openweb fidelity exec searchFunds '{"searchFilter":{"includeLeveragedAndInverseFunds":"N","openToNewInvestors":"OPEN","investmentTypeCode":"MFN"},"sortBy":"legalName","sortOrder":"ASC","currentPageNumber":1,"businessChannel":"RETAIL","noOfRowsPerPage":10,"subjectAreaCode":"fundInformation,mstarRatings"}'

# Get Fidelity fund picks (large blend domestic stock)
openweb fidelity exec getFundPicks '{"mstarAssetClassCd":"DSTK","mstarCtgyCd":"LB"}'

# Get fund performance (FXAIX = Fidelity 500 Index Fund, CUSIP 315911750)
openweb fidelity exec getFundPerformance '{"cusip":"315911750","funduniverse":"RETAIL","documentId":"315911750"}'
```

---

## Site Internals

## API Architecture
- **digital.fidelity.com**: POST BFF APIs at `/prgw/digital/research/api/*` (Angular frontend)
- **fundresearch.fidelity.com**: GET/POST APIs at `/mutual-funds/api/v1/*` and `/fund-screener/api/*`
- Internal APIs, no official documentation

## Auth
- No login required for included operations (all public market data)
- POST endpoints on digital.fidelity.com use CSRF tokens (`api_response` type from `/prgw/digital/research/api/tokens`)
- Account/trading endpoints require full auth (not included)

## Transport
- **digital.fidelity.com**: `page` transport required (PerimeterX bot detection blocks node)
- **fundresearch.fidelity.com**: `node` transport (direct HTTP works)

## Known Issues
- **PerimeterX**: Active on digital.fidelity.com — node transport blocked, must use page transport with browser tab open
- **ssrfValidator propagation**: Page transport CSRF resolution hits ssrfValidator bug (see chatgpt/pipeline-gaps.md) — digital.fidelity.com operations may fail until runtime fix is applied
- **Fund CUSIPs**: Mutual fund endpoints use CUSIP identifiers. Common: FXAIX=315911750, FBGRX=316071109
- **Numeric strings**: Prices and percentages returned as strings, not numbers
