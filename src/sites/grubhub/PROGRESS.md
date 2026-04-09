## 2026-04-09: Initial add — searchRestaurants, getMenu, getDeliveryEstimate

**What changed:**
- New site package: Grubhub (food delivery)
- 3 operations via adapter (L3): searchRestaurants, getMenu, getDeliveryEstimate
- Page transport (Cloudflare + PerimeterX + DataDome bot detection)
- API at api-gtm.grubhub.com, no auth required for reads

**Why:**
- Cover food delivery vertical alongside Uber Eats, DoorDash, Starbucks

**Verification:** API-level (browser fetch), content-level (real restaurant data), build
