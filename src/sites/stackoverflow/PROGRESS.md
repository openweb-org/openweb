# StackOverflow — Progress

## 2026-04-24 — Adapter for response quality (QA)

Added `adapters/stackoverflow.ts` to fix raw API output issues discovered during blind userflow QA.

### Issues found (3 personas: developer debugging, learner, expert browsing)
- HTML entities in titles (`&#39;`, `&quot;`, `&lt;`) — not decoded
- Raw HTML in body fields (getQuestion, getAnswers) — `<pre><code>`, `<p>`, `<a>` tags
- Bloated owner objects — profile_image, account_id, user_type, accept_rate, link fields
- Noisy metadata — content_license, is_moderator_only, community_owned_date, protected_date, last_edit_date

### Fixes
- **Adapter**: decodes HTML entities in titles, converts body HTML to markdown (code blocks, inline code, links preserved), trims owner to {display_name, reputation, user_id}, drops noise fields
- **Spec**: updated response schemas to match adapter output — getQuestion/getUser return object (not array), getAnswers drops redundant question_id, searchTags returns only {name, count}
- **tool_version**: bumped to 2 on all 5 operations

### Verification
- All 5 ops pass `pnpm dev verify stackoverflow`
- No lint errors in adapter
- Pre-existing test failure (producthunt adapter-pattern) unrelated
