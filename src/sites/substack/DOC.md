# Substack

## Overview
Newsletter publishing platform. Search posts and newsletters, browse categories, explore publication archives, read articles, view comments, and discover authors via Substack's REST API.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchPosts | search articles by keyword | REST POST | `/api/v1/post/search`; returns titles, authors, publications |
| searchPublications | search newsletters by keyword | REST POST | `/api/v1/publication/search`; returns publication metadata |
| searchPeople | search authors/people | REST POST | `/api/v1/search/profiles`; returns author info |
| getCategories | list all newsletter categories | REST GET | `/api/v1/category/public/all`; technology, culture, politics, etc. |
| getCategoryNewsletters | get newsletters in a category | REST GET | paginated by page number; paid/free filter |
| getLeaderboard | get top paid newsletters | REST GET | ranked by subscriber count/revenue |
| getPublicationArchive | get recent posts from a newsletter | REST GET | `{subdomain}.substack.com/api/v1/archive`; paginated |
| getPost | get full article details by slug | REST GET | `{subdomain}.substack.com/api/v1/posts/{slug}`; includes body HTML |
| getPostComments | get comments on a post | REST GET | `{subdomain}.substack.com/api/v1/post/{id}/comments`; threaded |
| getAuthorProfile | get author profile | DOM | navigates to `@handle` page, extracts from rendered HTML |

## API Architecture
- **REST-first**: Data served through `/api/v1/*` JSON endpoints
- **Decentralized**: Main site (substack.com) handles search/discovery; each publication has its own subdomain with archive/post/comment APIs
- **Custom domains**: Publications can use custom domains (e.g., platformer.news) which proxy to substack infra
- **Server-side rendering**: Some pages (author profiles) render server-side without separate API calls

## Auth
- Most operations work without auth (`requires_auth: false`)
- Logged-in users get personalized feeds and subscriber-only content
- Session tracked via `substack.sid` cookie
- No CSRF token required for read operations

## Transport
- `transport: page` — browser fetch for all operations
- Publication APIs require navigating to the publication's domain first (cross-origin)
- API calls use `credentials: 'include'` for cookie propagation

## Extraction
- **Adapter-based**: All operations use the `substack-api` adapter
- 9 operations use REST API calls via `page.evaluate(fetch(...))`
- 1 operation (getAuthorProfile) uses page navigation + DOM extraction

## Known Issues
- **Cross-origin publication APIs**: Operations like getPublicationArchive require navigating to the publication's subdomain first, which adds latency
- **Custom domain variability**: Some publications use custom domains; the adapter normalizes to `{subdomain}.substack.com`
- **Paywalled content**: Posts with `audience: "only_paid"` return truncated body HTML
- **Author profile DOM scraping**: Profile data extracted from rendered page, may break if layout changes
- **Rate limiting**: Substack may rate-limit heavy API usage
