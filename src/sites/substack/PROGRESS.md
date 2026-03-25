# Substack Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created substack with 10 operations: searchPosts, searchPublications, searchPeople, getCategories, getCategoryNewsletters, getLeaderboard, getPublicationArchive, getPost, getPostComments, getAuthorProfile

**Why:**
- Substack is the leading newsletter publishing platform — article discovery, newsletter browsing, author profiles
- 9 of 10 operations use REST API at `/api/v1/*`; 1 uses DOM extraction (author profile)
- Decentralized API model: main site handles search/discovery, publications have own subdomain APIs
- No aggressive bot detection on REST endpoints; browser context needed for cookie propagation

**Discovery process:**
1. Browsed homepage, search pages (AI, technology, science), categories page, individual categories (technology, culture), leaderboard, notes feed, recommendations, discover page
2. Visited individual publications (Platformer, Stratechery), their archives, and individual posts
3. Visited author profiles (@caseyNewton)
4. Identified REST API pattern: main site uses `/api/v1/post/search`, `/api/v1/publication/search`, `/api/v1/search/profiles`, `/api/v1/category/public/*`
5. Individual publications use `{subdomain}.substack.com/api/v1/archive`, `/api/v1/posts/{slug}`, `/api/v1/post/{id}/comments`
6. Built adapter with `page.evaluate(fetch(...))` pattern for REST API and page navigation for DOM extraction

**Verification:** Pending live verification — adapter built from observed API patterns during browsing session. REST endpoints follow standard Substack API conventions. Cross-origin publication API calls require navigating to the publication subdomain first.

**Knowledge updates:** Substack uses decentralized REST API — main site for search/discovery, per-publication subdomains for content. No GraphQL. Custom domains proxy to substack infrastructure. Session cookie: `substack.sid`.
