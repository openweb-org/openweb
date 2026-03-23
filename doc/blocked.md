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

| google-maps | https://www.google.com/maps | Headless browser blocked | Google consent screen / CAPTCHA blocks headless Playwright |

## To Unblock

For each site:
1. Run `openweb login <site>` or navigate to the login URL in managed Chrome
2. Complete authentication manually
3. Re-run the M26 discovery workflow

## Completed Sites

| Site | URL | Status | Operations |
|------|-----|--------|------------|
| stripe | https://dashboard.stripe.com | Compiled + curated | 20 operations |
