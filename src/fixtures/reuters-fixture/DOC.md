# Reuters Fixture

## Overview
Reuters (reuters.com) — global news agency. 10 operations covering top news, article search, section feeds, market data, and company profiles.

## Operations
| Operation | Intent | Notes |
|-----------|--------|-------|
| getTopNews | Get top/front page headlines | Reuters homepage feed |
| searchArticles | Search articles by keyword | Full-text search |
| getArticle | Get single article details | Article content |
| getWorldNews | Get world news section | Section feed |
| getBusinessNews | Get business news section | Section feed |
| getTechnologyNews | Get technology news section | Section feed |
| getLegalNews | Get legal news section | Section feed |
| getMarketData | Get market data overview | Market indices, prices |
| getCompanyProfile | Get company profile | Company info |
| getQuote | Get stock/index quote | Price quote |

## Auth
- No auth needed for public articles
- `requires_auth: false`
