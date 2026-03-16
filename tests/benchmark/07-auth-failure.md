# Benchmark 7: Structured Error — Auth Failure Classification

## Task

Attempt to execute an operation that requires authentication without the browser running (or with CDP unreachable). Verify that the error output contains the correct `failureClass` for agent decision-making.

## Mode

Any authenticated mode — test with `instagram-fixture` (session_http).

## Scenario A: No CDP endpoint

```
openweb instagram-fixture exec getTimeline '{}' --cdp-endpoint http://localhost:19999
```

(Port 19999 should have nothing listening)

## Expected Error Output (stderr)

```json
{
  "error": "execution_failed",
  "code": "EXECUTION_FAILED",
  "message": "...",
  "action": "...",
  "retriable": true,
  "failureClass": "needs_browser"
}
```

## Scenario B: Wrong site name

```
openweb nonexistent exec something '{}'
```

## Expected Error Output (stderr)

```json
{
  "error": "execution_failed",
  "code": "TOOL_NOT_FOUND",
  "message": "Site not found: nonexistent",
  "action": "Run `openweb sites` to list available sites.",
  "retriable": false,
  "failureClass": "fatal"
}
```

## Success Criteria

- Agent receives structured JSON error on stderr
- `failureClass` matches the expected classification
- Agent can parse the error and decide the correct recovery action:
  - `needs_browser` → "Start Chrome with remote debugging"
  - `fatal` → "Don't retry, check site name"
- Agent does NOT blindly retry a `fatal` error

## Failure Criteria

- Error output is not valid JSON
- `failureClass` is missing or wrong
- Agent retries a `fatal` error
- Agent doesn't recognize the error format
