# M26 Blocked Sites

Sites that could not be discovered due to authentication requirements.
All require browser login before capture + compile can proceed.

## Blocked Sites

| Site | URL | Blocker | Redirect |
|------|-----|---------|----------|
| todoist | https://app.todoist.com | Not logged in | `/auth/login` |
| sentry | https://sentry.io | Not logged in | `/auth/login/` |
| netlify | https://app.netlify.com | Not logged in | Shows SSO/signup (no API traffic) |
| vercel | https://vercel.com | Not logged in | `/login` |
| supabase | https://supabase.com/dashboard | Not logged in | `/sign-in` |
| shortcut | https://app.shortcut.com | Not logged in | `/login` |
| terraform-cloud | https://app.terraform.io | Not logged in | `/login` |
| amplitude | https://app.amplitude.com | Not logged in | `/login` |
| asana | https://app.asana.com | Not logged in | `/-/login` |
| circleci | https://app.circleci.com | Not logged in | `/login` |
| linear | https://linear.app | Not logged in | SPA renders login at root (no redirect); GraphQL shows `isLoggedInUser: false` |
| mongodb-atlas | https://cloud.mongodb.com | Not logged in | `account.mongodb.com/account/login` |
| twilio | https://www.twilio.com/console | Not logged in | `/login` |
| webflow | https://webflow.com/dashboard | Not logged in | `/login` |
| ynab | https://app.ynab.com | Not logged in | `/users/sign_in` |
| zendesk | https://www.zendesk.com | Not logged in | `/login` (instance-specific subdomain needed) |
| jira | https://id.atlassian.com | Not logged in | Atlassian SSO login required; `id.atlassian.com/login` |
| confluence | https://id.atlassian.com | Not logged in | Atlassian SSO login required; instance URL also needed |
| cloudflare | https://dash.cloudflare.com | Cloudflare challenge loop | Stuck on "Just a moment..." — CF challenge never resolves in managed Chrome |
| airtable | https://airtable.com | Not logged in | Marketing page only; internal API is POST-heavy (compiler limitation) |
| figma | https://www.figma.com | Not logged in | Redirects to `/login` |
| notion | https://www.notion.so | Compiler limitation | Logged in, but all API endpoints are POST with request bodies; compiler skips POST mutations (no body inference yet) |
| calendly | https://calendly.com | Not logged in | Redirects to `/app/login` |
| clickup | https://app.clickup.com | Not logged in | Redirects to `/login`; WebSocket JWT auth pattern |
| google-maps | https://www.google.com/maps | Headless browser blocked | Google consent screen / CAPTCHA blocks headless Playwright |
| grafana | https://grafana.com | Not logged in | Requires Grafana Cloud login; self-hosted instances need configSchema URL |
| posthog | https://us.posthog.com | Not logged in | Requires PostHog account; CSRF token from `posthog_csrftoken` cookie |
| cockroachdb | https://cockroachlabs.cloud | Not logged in | gRPC-Web protocol over session cookies; no public endpoints |
| ebay | https://www.ebay.com | SSR-only + JSONP | No JSON APIs for search/items; data is SSR HTML extraction. Autosug uses JSONP callback, not JSON. Needs login for user features. |
| yelp | https://www.yelp.com | DataDome CAPTCHA | All HTML pages and `/gql/batch` return DataDome CAPTCHA challenge (403). Only `/search_suggest/v2/prefetch` works without auth (autocomplete suggestions only, no business data). Yelp Fusion v3 API requires API key. SSR data in `window.yelp.react_root_props` inaccessible. |
| zillow | https://www.zillow.com | PerimeterX CAPTCHA | All endpoints return 403 with PerimeterX "Press & Hold" CAPTCHA (app ID `PXHYx10rg3`). Blocks CDP browser, direct HTTP (curl), and even default browser profiles. Search API (`/search/GetSearchPageState.htm`), GraphQL (`/zg-graph`), autocomplete (`/autocomplete/v3/suggestions`), and property detail (`/ajax/homedetails/GetHomeDetails.htm`) all behind PX. `robots.txt` accessible but no data endpoints. |

## To Unblock

For each site:
1. Run `openweb login <site>` or navigate to the login URL in managed Chrome
2. Complete authentication manually
3. Re-run the M26 discovery workflow

## Completed Sites

| Site | Notes |
|------|-------|
| google-search | Works — headless Chrome not blocked (unlike google-maps). Autocomplete via node, web/image search via page_global_data extraction. |
