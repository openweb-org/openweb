# GoodRx Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created goodrx-fixture with 10 operations: getDrugPrices, getDrugInfo, getDrugOffers, getDrugPricesByDosage, getHomeDeliveryPrices, getDrugDescription, getDrugFAQ, getDrugArticles, getPopularDrugs, getDrugConcept

**Why:**
- GoodRx is the leading drug price comparison platform — pharmacy coupon prices, drug info, and savings data
- All 10 operations work without auth via DOM/JSON-LD extraction and GraphQL API
- GoodRx uses PerimeterX bot detection — only browser-based access works (transport: page)

**Discovery process:**
1. Browsed homepage, drug pricing pages (/metformin, /lisinopril, /lipitor), drug info pages (/metformin/what-is), and search page
2. Discovered GoodRx uses Next.js App Router with RSC (not classic __NEXT_DATA__) and GraphQL API at graph.goodrx.com
3. Found rich JSON-LD structured data: Drug schema with offers, MedicalWebPage, FAQPage — embedded in every drug page
4. Captured 5 GraphQL operations: QueryMostPopularSearchResults, LatestHealthArticlesByDrug, SharePricingModal (drugConceptBySlug), MostPopularPharmacyChainRecommendedOffers, AudienceSegmentMemberships
5. Built adapter with DOM/JSON-LD extraction for pricing and drug info, plus GraphQL fetch for articles and popular drugs
6. Pharmacy prices extracted from LI elements; dosage pricing from tab-delimited text; drug metadata from JSON-LD

**Verification:** Content-level verification confirmed: pharmacy prices match visible page data (CVS $17.14, Walmart $9.00, Walgreens $13.34 for lisinopril), JSON-LD Drug schema returns correct metadata (name, drugClass, offers), FAQPage returns Q&A pairs, GraphQL returns articles with authors and thumbnails.

**Knowledge updates:** GoodRx uses Next.js App Router with RSC (not Pages Router with __NEXT_DATA__). PerimeterX bot detection requires homepage warm-up before drug page navigation. GraphQL API at graph.goodrx.com requires session cookies from browser context.
