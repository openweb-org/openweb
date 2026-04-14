# GoodRx

## Overview
Drug price comparison platform. Compare prescription drug prices across pharmacies and find nearby pharmacies.

## Workflows

### Find drug prices
1. `searchDrugs(query)` → `name`, `url` (url path = slug)
2. `getDrugPrices(slug)` → pharmacy prices with `drugName`, `pharmacy`, `price`

### Find pharmacies near me
1. `getPharmacies(zipCode?)` → list of pharmacy chains with URLs

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchDrugs | search for a drug | query | name, url | entry point; autocomplete results |
| getDrugPrices | compare prices across pharmacies | slug ← searchDrugs | drugName, pharmacy, price | coupon prices at CVS, Walgreens, etc. |
| getPharmacies | find nearby pharmacies | zipCode (optional) | name, slug, url | entry point; defaults to browser geolocation |

## Quick Start

```bash
# Search for a drug
openweb goodrx exec searchDrugs '{"query":"metformin"}'

# Get drug prices at pharmacies
openweb goodrx exec getDrugPrices '{"slug":"metformin"}'

# Find nearby pharmacies
openweb goodrx exec getPharmacies '{}'

# Find pharmacies by ZIP code
openweb goodrx exec getPharmacies '{"zipCode":"90210"}'
```
