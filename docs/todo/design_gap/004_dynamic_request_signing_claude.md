# Design Gap: Dynamic Request Signing and Cryptographic Auth

## Severity: CRITICAL

## Problem

Some APIs require per-request cryptographic signatures computed client-side. The
signing logic uses timestamps, secret keys, or obfuscated algorithms that change
with each request. HAR captures already-signed requests, but replaying them with
stale signatures fails.

This is a fundamental blocker because the signature is cryptographically bound to
the request timestamp — there is no way to replay it.

## Affected Sites

**SAPISIDHASH (Google services):**
- YouTube, Google Analytics, Google Calendar, Google Drive, Google Cloud
- Algorithm: `SHA-1(timestamp + " " + SAPISID_cookie + " " + origin)`
- Changes every request; requires live SAPISID cookie + current timestamp

**AWS SigV4:**
- AWS Console
- Full request signing with temporary credentials (access key, secret, session token)
- Credentials expire every ~15 minutes
- Includes request timestamp and region in signature scope

**Anti-scraping signatures:**
- TikTok — `byted_acrawler.frontierSign(url)` generates `X-Bogus` parameter
- OnlyFans — Webpack module `977434` function `JA` generates signing headers;
  the algorithm is obfuscated and only accessible at runtime

**Persisted-but-dynamic headers:**
- X (Twitter) — Feature flags regenerated per-request from page globals
- Cloudflare — `x-atok` header is timestamp-prefixed anti-forgery token that
  refreshes on each page load

## Why OpenWeb Can't Handle It

1. HAR captures signed requests at recording time; signatures are stale at replay
2. Signing algorithms are proprietary, obfuscated, or depend on runtime state
3. Credentials/keys used for signing expire (AWS ~15min, Google per-session)
4. No way to extract the signing function from HAR — it's JavaScript code, not
   HTTP data
5. Even if the algorithm is known (SigV4, SAPISIDHASH), OpenWeb needs live
   credentials to re-sign, which requires browser state access (see gap #002)

## Potential Mitigations

- **Known algorithm library**: Implement known signing algorithms (SigV4,
  SAPISIDHASH) in the runtime executor and re-sign requests with fresh credentials
- **Webpack function extraction**: For obfuscated signers (OnlyFans, TikTok),
  extract the signing function from the page and execute it in a sandboxed
  environment at replay time
- **Browser-only mode**: For signed APIs, always use `browser_fetch` mode where
  the page's own signing logic runs naturally
- **Accept the limitation**: Document that cryptographically signed APIs require
  browser execution and cannot be replayed via `direct_http`
