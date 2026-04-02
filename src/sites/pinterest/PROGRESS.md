## 2026-04-01: Initial discovery and compilation

**What changed:**
- Discovered Pinterest resource API pattern (`/resource/{ResourceName}/get/`)
- Compiled 5 operations: searchPins, getPin, getBoard, getUserProfile, searchTypeahead
- Set page transport (Pinterest bot detection blocks node)
- Configured cookie_session auth with csrftoken CSRF
- Added Pinterest-specific headers as const parameters (x-requested-with, x-pinterest-appstate, etc.)

**Why:**
- First discovery of Pinterest site package
- Pinterest has aggressive bot detection requiring page transport and custom headers

**Verification:** page transport with browser, search confirmed working via page.evaluate(fetch)
