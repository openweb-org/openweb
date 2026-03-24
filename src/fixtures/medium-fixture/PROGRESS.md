# Medium Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created medium-fixture with 10 operations: searchArticles, getTagFeed, getTagCuratedLists, getTagWriters, getRecommendedFeed, getRecommendedTags, getPublicationPosts, getPostClaps, getRecommendedWriters, getUserProfile

**Why:**
- Medium is the leading blogging/publishing platform — article discovery, topic browsing, publication exploration
- 8 of 10 operations use GraphQL API at `/_/graphql`; 2 use DOM extraction (search, user profile)
- No aggressive bot detection; browser context needed for cookie propagation

**Discovery process:**
1. Browsed homepage, search pages (AI, web dev), tag pages (programming, technology, AI, data-science, machine-learning), publications (Towards Data Science, Better Programming), user profiles, explore topics, staff picks
2. Captured 167 GraphQL requests across 22 distinct operation types
3. Selected 8 GraphQL operations covering core user intents: tag feeds, curated lists, recommended content, publication posts, engagement metrics
4. Added 2 DOM-extraction operations for search and user profiles (SSR-rendered, no dedicated GraphQL query)
5. Built adapter with `page.evaluate(fetch(...))` pattern for GraphQL and page navigation for DOM extraction
6. Modeled response schemas from captured traffic samples

**Verification:** Content-level verification confirmed: TopicLatestStorieQuery returns programming tag feed with real posts (titles, authors, clap counts, reading time), TopicCuratedListQuery returns curated reading lists ("How to ace your engineering interview" by Medium Staff), WebInlineRecommendedFeedQuery returns trending articles with full metadata, RightSidebarQuery returns 7 recommended tags (Programming, Data Science, Technology, etc.), PublicationSectionPostsQuery returns Better Programming posts by ID with full details.

**Knowledge updates:** Medium uses batched GraphQL (requests/responses are JSON arrays). All content data served through `/_/graphql` POST endpoint. Search results SSR-rendered, not via separate GraphQL query. Apollo Client for frontend state management. No CSRF token needed for read queries.
