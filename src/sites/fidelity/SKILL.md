# Fidelity

## Overview
Financial services platform. Stock quotes, market indices, mutual fund research, company profiles, and news from Fidelity Investments.

## Workflows

### Look up a stock
1. `getQuote(symbol)` → lastPrice, volume, peRatio, marketCap, 52-week range
2. `getCompanyProfile(symbols)` → sector, industry, employeeCount, description
3. `getNewsHeadlines(symbol)` → headlines[].text, provider, impactRating

### Research mutual funds
1. `listAssetClasses` → `code` (mstarAssetClassCd), categories[].`code` (mstarCtgyCd)
2. `searchFunds(searchFilter)` → funds[].fundInformation.`cusip`, ticker, legalName
3. `getFundPicks(mstarAssetClassCd, mstarCtgyCd)` → funds[].fundInformation.`cusip`, ticker
4. `getFundPerformance(cusip)` → YTD, 1/3/5/10yr annual returns
5. `getFundSummary(cusip)` → composition, ratings, fees, top10Holdings

### Market overview
1. `getMarketSummary` → quotes[].label, lastPrice, pctChgToday (S&P 500, DJIA, NASDAQ)
2. `getIndexQuotes(symbol)` → quotes[].name, pctChgToday (global indices, currencies)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getQuote | real-time stock price | symbol | lastPrice, netChgToday, pctChgToday, volume, marketCap | adapter: fidelity-api |
| getMarketSummary | major US indices | — | quotes[].label, lastPrice, netChgToday | adapter: fidelity-api, entry point |
| getCompanyProfile | company details | symbols[] | companyName, sector, industry, employeeCount | adapter: fidelity-api |
| getNewsHeadlines | stock/market news | symbol | headlines[].text, provider, resDate, impactRating | adapter: fidelity-api |
| getIndexQuotes | global indices/forex | symbol (comma-separated) | quotes[].name, pctChgToday | adapter: fidelity-api |
| getResearchData | analyst ratings/holdings | apiTokenName, params | varies by apiTokenName | adapter: fidelity-api, proxy endpoint |
| getCompanyLogo | company logo URL | fvSymbols | logo URL | adapter: fidelity-api |
| searchFunds | browse/filter mutual funds | searchFilter, pageNumber, noOfRowsPerPage | funds[].fundInformation, mstarOverallRating | entry point for fund research |
| listAssetClasses | asset class/category codes | — | code, description, categories[] | entry point for screening |
| listFundFamilies | fund family names | — | code, description | entry point |
| getFundPicks | recommended funds | mstarAssetClassCd, mstarCtgyCd ← listAssetClasses | fundPicks.funds[].ticker, legalName, mstarOverallRating | |
| getFundPerformance | fund annual returns | cusip ← searchFunds/getFundPicks | performanceAverageAnnualReturns | CUSIP from fund search |
| getFundSummary | fund composition/fees | cusip ← searchFunds/getFundPicks | fundInformation, details (expenseRatio, NAV), top10Holdings, quarterEndAverageAnnualReturns | CUSIP from fund search |

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
