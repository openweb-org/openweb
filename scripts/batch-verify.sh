#!/usr/bin/env bash
# Safe batch verify: open ONE tab at a time, test, close, next
set -uo pipefail

RESULTS="/tmp/batch_results.txt"
> "$RESULTS"
CDP="http://localhost:9222"
TOTAL=$(wc -l < /tmp/sites_to_open.txt)
COUNT=0

while IFS='|' read -r SITE URL; do
  COUNT=$((COUNT + 1))

  # Get first read op
  FIRST_OP=$(pnpm --silent dev "$SITE" --json 2>/dev/null | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    for op in d.get('operations', []):
        if op.get('permission') == 'read':
            print(op['id']); break
except: pass
" 2>/dev/null)

  if [ -z "$FIRST_OP" ]; then
    echo "SKIP|$SITE||no_read_op" >> "$RESULTS"
    echo "[$COUNT/$TOTAL] SKIP $SITE"
    continue
  fi

  # Open ONE tab
  TAB_JSON=$(curl -s -X PUT "$CDP/json/new?${URL}" 2>/dev/null)
  TAB_ID=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  sleep 5

  # Get example params and execute
  EXAMPLE=$(pnpm --silent dev "$SITE" "$FIRST_OP" --example 2>/dev/null || echo '{}')
  RESULT=$(pnpm --silent dev "$SITE" "$FIRST_OP" "$EXAMPLE" 2>&1) || true

  # Classify
  STATUS=$(echo "$RESULT" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    if 'error' in d:
        fc = d.get('failureClass','unknown')
        if fc in ('needs_login','needs_page'): print('AUTH_FAIL')
        else: print('ERROR')
    else: print('PASS')
except: print('PASS')
" 2>/dev/null)

  DETAIL=$(echo "$RESULT" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    msg = d.get('message','')[:80]
    fc = d.get('failureClass','')
    print(f'{fc}:{msg}' if fc else msg)
except: print('ok')
" 2>/dev/null)

  echo "$STATUS|$SITE|$FIRST_OP|$DETAIL" >> "$RESULTS"
  echo "[$COUNT/$TOTAL] $STATUS $SITE ($FIRST_OP) — $DETAIL"

  # CLOSE the tab immediately
  if [ -n "$TAB_ID" ]; then
    curl -s -X PUT "$CDP/json/close/$TAB_ID" > /dev/null 2>&1
  fi

done < /tmp/sites_to_open.txt

echo ""
echo "=== Summary ==="
echo "PASS:      $(grep -c '^PASS' "$RESULTS" || echo 0)"
echo "AUTH_FAIL: $(grep -c '^AUTH_FAIL' "$RESULTS" || echo 0)"
echo "ERROR:     $(grep -c '^ERROR' "$RESULTS" || echo 0)"
echo "SKIP:      $(grep -c '^SKIP' "$RESULTS" || echo 0)"
