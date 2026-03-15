# Design Gap: GraphQL Persisted Query Hash Expiration

## Severity: HIGH

## Problem

Modern GraphQL clients use "persisted queries" where GraphQL operations are compiled
into SHA256 hashes at build time. The client sends the hash instead of the full query
string. When the application deploys a new version, all hashes change, and requests
with old hashes fail with `PersistedQueryNotFound`.

Plugins extract these hashes at runtime from webpack chunks or maintain hardcoded
fallback snapshots. OpenWeb's HAR captures requests with specific hashes that become
stale after deployment.

## Affected Sites

- **GitHub** — Persisted mutation IDs extracted via regex from JS bundles.
  `CreatePullRequestMutation` compiles to a hex hash that changes per deploy.
  Plugin catches `unknownQuery` error, clears cache, re-discovers from bundles.
- **Instacart** — Apollo Client persisted queries extracted from
  `webpackChunk` module 47096. Falls back to `FALLBACK_HASHES` snapshot.
- **X (Twitter)** — GraphQL operation hashes extracted from
  `webpackChunk_twitter_responsive_web` chunk registry.
- **Spotify** — Persisted query hashes expire when client deploys new version.

## Why OpenWeb Can't Handle It

1. HAR captures requests with specific hashes — hashes expire when site deploys
2. Hash discovery requires parsing minified JavaScript bundles at runtime
3. Webpack chunk IDs and module IDs change across versions
4. No HTTP-level signal indicates that hashes have expired — the GraphQL error
   response format varies per site
5. OpenWeb's spec would contain stale hashes that break after the first deploy

## Potential Mitigations

- **Dynamic hash extraction**: During replay, if a persisted query fails, fetch
  the page's JS bundles and extract fresh hashes via regex
- **Full query fallback**: Include the full GraphQL query string in the spec so
  the runtime can fall back to sending the full query when the hash is stale
  (many servers accept both)
- **Version detection**: Monitor the site's client version (often in page globals
  or `<meta>` tags) and trigger re-compilation when it changes
- **Self-healing**: On `PersistedQueryNotFound` error, automatically re-run the
  compiler to update hashes
