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

| google-maps | https://www.google.com/maps | Headless browser blocked | Google consent screen / CAPTCHA blocks headless Playwright |
| grafana | https://grafana.com | Not logged in | Requires Grafana Cloud login; self-hosted instances need configSchema URL |
| posthog | https://us.posthog.com | Not logged in | Requires PostHog account; CSRF token from `posthog_csrftoken` cookie |
| cockroachdb | https://cockroachlabs.cloud | Not logged in | gRPC-Web protocol over session cookies; no public endpoints |
| ebay | https://www.ebay.com | SSR-only + JSONP | No JSON APIs for search/items; data is SSR HTML extraction. Autosug uses JSONP callback, not JSON. Needs login for user features. |

## To Unblock

For each site:
1. Run `openweb login <site>` or navigate to the login URL in managed Chrome
2. Complete authentication manually
3. Re-run the M26 discovery workflow

## Completed Sites

| Site | URL | Status | Operations |
|------|-----|--------|------------|
| stripe | https://dashboard.stripe.com | Compiled + curated | 20 operations |
| yelp | https://www.yelp.com | Compiled + curated | 1 operation (autocomplete) |
| bestbuy | https://www.bestbuy.com | Compiled + curated | 1 operation (priceBlocks) |
| docker-hub | https://hub.docker.com | Compiled + curated | 4 operations (search, repo, tags) |
