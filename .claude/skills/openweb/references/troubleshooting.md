# Troubleshooting

Process guide for diagnosing and fixing openweb failures.

## Step 1: Classify the failure

| Symptom | Category | Look at |
|---------|----------|---------|
| 401, 403, token errors | Auth | `knowledge/troubleshooting-patterns.md` → Auth Failures |
| No traffic captured, login redirect | Discovery / Capture | `knowledge/troubleshooting-patterns.md` → Discovery Failures |
| No operations in compiled spec | Compile | `knowledge/troubleshooting-patterns.md` → Compile Failures |
| verify fails, schema mismatch, 429 | Verify / Drift | `knowledge/troubleshooting-patterns.md` → Verify Failures |
| CDP connection error, no tab | Browser | `knowledge/troubleshooting-patterns.md` → Browser Failures |

## Step 2: Check known patterns

Read `knowledge/troubleshooting-patterns.md` for the matching category. Most failures have a known cause/fix pattern.

## Step 3: If not a known pattern — diagnose

1. Check the exact error message and HTTP status
2. Check `openweb browser status` — is Chrome running?
3. Check if the site is in `doc/blocked.md` — known blocker?
4. Try the operation with `--verbose` for more detail
5. Check the fixture's `openapi.yaml` — is the endpoint/auth correct?

## Step 4: Fix and verify

Apply the fix, then:
```bash
openweb verify <site>          # single site
pnpm build && pnpm test        # ensure no regressions
```

## Step 5: Update Knowledge

→ Read `update-knowledge.md` — if you learned something novel during debugging, write it to `knowledge/`.
