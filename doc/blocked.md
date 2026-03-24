# Blocked Sites

## Truly Blocked — bot detection / needs new primitive

These cannot be unblocked by login alone.

| Site | URL | Blocker |
|------|-----|---------|
| tiktok | https://www.tiktok.com | X-Bogus custom signing + SSR. All API requests require client-side VM-computed signatures (X-Bogus, X-Gnarly, msToken). Core content in SSR `__UNIVERSAL_DATA_FOR_REHYDRATION__`. Needs L3 adapter. |
| zillow | https://www.zillow.com | PerimeterX CAPTCHA. All endpoints return 403. Blocks CDP browser, direct HTTP, and even default browser profiles. |
| yelp | https://www.yelp.com | DataDome CAPTCHA. All pages and `/gql/batch` return 403. SSR data in `window.yelp.react_root_props` inaccessible. |
| cloudflare | https://dash.cloudflare.com | Cloudflare challenge loop. Stuck on "Just a moment..." — CF challenge never resolves in managed Chrome. |
| google-maps | https://www.google.com/maps | Google consent screen / CAPTCHA blocks headless Playwright. |
| cockroachdb | https://cockroachlabs.cloud | gRPC-Web protocol over session cookies; no public endpoints. |
| ebay | https://www.ebay.com | SSR-only + JSONP. No JSON APIs for search/items; needs HTML extraction or login for user features. |
| notion | https://www.notion.so | All API endpoints are POST with request bodies; compiler skips POST mutations (no body inference yet). |

## Needs Login — unblock by logging in

| Site | URL | Redirect |
|------|-----|----------|
| todoist | https://app.todoist.com | `/auth/login` |
| sentry | https://sentry.io | `/auth/login/` |
| netlify | https://app.netlify.com | Shows SSO/signup |
| vercel | https://vercel.com | `/login` |
| supabase | https://supabase.com/dashboard | `/sign-in` |
| shortcut | https://app.shortcut.com | `/login` |
| terraform-cloud | https://app.terraform.io | `/login` |
| amplitude | https://app.amplitude.com | `/login` |
| asana | https://app.asana.com | `/-/login` |
| circleci | https://app.circleci.com | `/login` |
| linear | https://linear.app | SPA login at root |
| mongodb-atlas | https://cloud.mongodb.com | `account.mongodb.com/account/login` |
| twilio | https://www.twilio.com/console | `/login` |
| webflow | https://webflow.com/dashboard | `/login` |
| ynab | https://app.ynab.com | `/users/sign_in` |
| zendesk | https://www.zendesk.com | `/login` (instance-specific) |
| jira | https://id.atlassian.com | Atlassian SSO |
| confluence | https://id.atlassian.com | Atlassian SSO |
| airtable | https://airtable.com | Marketing page only |
| figma | https://www.figma.com | `/login` |
| calendly | https://calendly.com | `/app/login` |
| clickup | https://app.clickup.com | `/login` |
| grafana | https://grafana.com | Grafana Cloud login |
| posthog | https://us.posthog.com | PostHog account needed |

## Completed Sites

| Site | Notes |
|------|-------|
| google-search | Works — headless Chrome not blocked. Autocomplete via node, web/image search via page_global_data extraction. |
