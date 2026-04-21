# Site Archetypes — Expected Operations

Quick-reference for typical operations by site category. Use during Step 1 (Frame) to set target operations before discovery.

> Archetypes are heuristic starting points, not limiting checklists. Define targets based on user needs and actual site capabilities.

## Archetype Matrix

| Archetype | Typical Examples |
|-----------|-----------------|
| **Social Media** | Short-form feed + social graph platforms |
| **Messaging** | Real-time chat + group communication |
| **Content Platforms** | Video, wiki, AI chat, community forums |
| **E-commerce** | Product search + cart + checkout |
| **Travel** | Listings + availability + booking |
| **Food Delivery** | Restaurant search + menu + ordering |
| **Job Boards** | Job search + company profiles + salary data |
| **Productivity / Enterprise** | Task/project management + collaboration |
| **Developer Tools** | Repos, issues, CI/CD, container registries |
| **Finance / Banking** | Portfolios, quotes, transactions |
| **Email** | Inbox, messages, contacts |
| **Cloud / Storage** | File management, sharing, sync |
| **Public Data APIs** | Weather, reference, fun facts |
| **News** | Headlines, articles, search |
| **Chinese Web** | Chinese-language equivalents of above categories |

---

## Social Media

- Read — core:
  - feed / timeline (paginated)
  - user profile
  - search (posts, users)
  - explore / discover feed (algorithmic recommendations)
  - trending / popular
  - notifications
  - followers list / following list
  - thread / conversation (full reply chain)
- Read — media:
  - reels / short-video feed
  - article / long-form content
  - stories (ephemeral, 24h expiry)
  - notes / status (lightweight text updates)
  - download media (images, videos)
- Write — content (reversible pairs):
  - createPost / deletePost
  - reply / deleteReply
  - comment / deleteComment
  - quote-post / deleteQuote
- Write — engagement (reversible pairs):
  - like / unlike
  - repost (retweet, reblog) / unrepost
  - bookmark / unbookmark
  - save / unsave (collections)
  - upvote / downvote / removeVote (for platforms with voting)
- Write — social graph (reversible pairs):
  - follow / unfollow
  - block / unblock
  - mute / unmute
  - acceptFollowRequest (one-way, for private accounts)
  - hideReply / unhideReply (platform-specific)
- Write — messaging (reversible pairs):
  - sendDM / deleteDM (private messages within social platforms)

## Messaging

- Read:
  - list conversations (paginated)
  - read messages (paginated)
  - list contacts
  - search messages
  - notifications
- Write (reversible pairs):
  - sendMessage / deleteMessage
  - addReaction / removeReaction
  - pinMessage / unpinMessage
- Write (one-way):
  - markAsRead
  - editMessage
- Real-time: WebSocket gateway for events

## Content Platforms

- Read — core:
  - feed / homepage (paginated)
  - content detail (by ID)
  - search
  - user / channel profile
  - comments (paginated)
  - notifications
  - explore / discover (recommendations)
- Read — media:
  - playlist / collection listing
  - transcript / captions
- Write — engagement (reversible pairs):
  - like / unlike
  - subscribe / unsubscribe
  - save / unsave
  - comment / deleteComment
- Write — library (reversible pairs):
  - addToPlaylist / removeFromPlaylist (music/video)
  - createPlaylist / deletePlaylist

> Note: some bundled content sites (e.g. youtube-music) are currently read-only — engagement/library writes are not yet implemented.

---

## E-commerce

- Read: search products, product detail (by ID), product reviews (paginated), price comparison
- Write (reversible pairs):
  - addToCart / removeFromCart
  - updateCartQuantity (set to 0 = remove)
  - saveItem (wishlist) / unsaveItem
- Read: view cart
- Transact (not yet implemented in any bundled site; placeholder for future): checkout, placeOrder

## Travel

- Read: search listings (paginated), listing detail (by ID), price/availability, reviews
- Write (reversible pairs, not yet implemented in any bundled site; placeholder for future):
  - saveProperty (wishlist) / unsaveProperty
- Transact (deny by default): book/reserve

## Food Delivery

- Read: search restaurants (paginated), restaurant menu (by ID), delivery estimate
- Write (reversible pairs):
  - addToCart / removeFromCart
- Transact (deny by default): placeOrder

## Job Boards

- Read: search jobs, job detail, company profile, salary data, reviews
- Write (reversible pairs, not yet implemented in any bundled site; placeholder for future):
  - saveJob / unsaveJob

---

## Productivity / Enterprise

- Read: list documents/items (paginated), document/item detail, search, dashboard/overview, notifications, activity feed
- Write (reversible pairs):
  - createItem / deleteItem (or archiveItem / unarchiveItem)
  - updateItem (reversible via re-update)
  - completeTask / uncompleteTask
  - assignItem / unassignItem
- Write (one-way): moveItem, addLabel, removeLabel

## Developer Tools

- Read: list repos/projects (paginated), repo detail, list issues (paginated), search, user/org profile, notifications, activity feed
- Write (reversible pairs):
  - starRepo / unstarRepo
  - createIssue / closeIssue (or reopenIssue)
  - createComment / deleteComment
  - watchRepo / unwatchRepo
- Write (one-way): forkRepo (creates new repo, no undo needed)

## Finance / Banking

- Read: account/portfolio overview, stock/asset quote (by symbol), market data, transaction history (paginated), search securities, watchlist
- Write & Transact (not yet implemented in any bundled site; bundled finance sites — robinhood, fidelity, xueqiu, yahoo-finance — are read-only; placeholder for future): addToWatchlist / removeFromWatchlist, placeOrder, transfer

## Email & Cloud / Storage

- Read: list inbox/files (paginated), read message/file metadata, search
- Write (reversible pairs):
  - starMessage / unstarMessage
  - moveToFolder / moveBack
  - archiveMessage / unarchiveMessage
- Write (one-way): sendMessage (email), uploadFile, deleteFile

---

## Public Data APIs

**Weather / Data:** Current data (read, by location/params), forecast/historical (read, by range), lookup by coordinates or ID (read)

**Prediction / Fun:** Query/predict (read, single call), random result (read)

**Reference / Lookup:** Search/list (read, paginated or filtered), detail by ID or name (read), random entry (read, if supported)

**News:** Headlines/feed (read, paginated), article detail (read, by ID/URL), search articles (read)

---

## Chinese Web

Operations vary by category — use the relevant archetype section (social, commerce, etc.) as a starting point. Common across Chinese sites:

- Search (read) — every site has some form of search
- Content detail (read, by ID) — article, video, product, stock quote
- User profile (read) — author, seller, company
- Feed / trending (read, paginated) — hot lists, rankings, recommendations
- Comments (read, paginated) — nested or flat
