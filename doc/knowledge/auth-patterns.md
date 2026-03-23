# Auth Patterns

Patterns observed across sites for authentication, CSRF, and request signing.

## No Auth (public sites)

Sites where all target data is publicly accessible:
- Google Search, DuckDuckGo, Wikipedia, CoinGecko, CatFact
- Tracking cookies (Cloudflare, GA) may trigger false-positive auth detection during compile

## Cookie Session

Browser session cookies required. User must log in via managed browser first.
- GitHub, Instagram, Discord, X, YouTube
- Cookies extracted from browser context for `node` transport via token cache

## CSRF Patterns

### cookie_to_header
Extract CSRF token from cookie and inject as request header.
- Most common pattern for REST APIs behind cookie auth

### meta_tag
Extract CSRF token from HTML `<meta>` tag.
- Rails-style apps, some Django apps

## Anti-XSSI Prefixes

Some sites prefix JSON responses with garbage to prevent XSSI:
- Google (`client=gws-wiz`): `)]}'` prefix on autocomplete responses
- Facebook/Meta: `for (;;);` prefix
- **Workaround**: Use alternative client params (e.g., Google `client=chrome` for clean JSON) or strip prefix in adapter

## Bot Detection

### Blocked
- Cloudflare challenge loop (dash.cloudflare.com)
- DataDome CAPTCHA (Yelp)
- Google consent screen + CAPTCHA (Google Maps — but NOT Google Search)

### Not Blocked
- Google Search: headless Chrome works without issues
- Walmart: `node` transport SSR extraction works
- Best Buy: `page` transport browser_fetch works (Akamai accepts browser context)
- Redfin: headless Chrome works without issues, page_global_data extraction from JSON-LD
