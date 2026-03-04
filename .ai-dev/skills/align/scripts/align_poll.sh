#!/usr/bin/env bash
# align_poll.sh — Block until it's your turn or alignment is DONE.
#
# Usage:
#   align_poll.sh <status_file> <AGENT> [interval_sec] [timeout_sec]
#
# Arguments:
#   status_file   Path to align/discussion/status.txt
#   AGENT         Your agent name: CODEX or CLAUDE
#   interval_sec  Poll interval in seconds (default: 15)
#   timeout_sec   Max wait time in seconds (default: 3600 = 1 hour, 0 = infinite)
#
# Behaviour:
#   - Blocks silently; all per-poll detail goes to poll.log next to status.txt.
#   - Prints exactly ONE line to stdout on exit so the calling agent gets
#     minimal context:
#       YOUR_TURN  — NEXT flipped to you; go ahead and write.
#       DONE       — Both sides approved; alignment finished.
#       TIMEOUT    — Gave up after timeout_sec.
#       ERROR      — status.txt missing or unparseable.
#
# Exit codes:  0 = YOUR_TURN or DONE,  1 = TIMEOUT,  2 = ERROR

set -euo pipefail

STATUS_FILE="${1:?Usage: align_poll.sh <status_file> <AGENT> [interval] [timeout]}"
AGENT="${2:?Usage: align_poll.sh <status_file> <AGENT> [interval] [timeout]}"
INTERVAL="${3:-15}"
TIMEOUT="${4:-3600}"

AGENT=$(echo "$AGENT" | tr '[:lower:]' '[:upper:]')
LOG_FILE="$(dirname "$STATUS_FILE")/poll.log"
START=$(date +%s)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

parse_status() {
  # Reads status.txt, sets NEXT, SEQ, CODEX_VOTE, CLAUDE_VOTE
  if [[ ! -f "$STATUS_FILE" ]]; then return 1; fi
  local line
  line=$(head -1 "$STATUS_FILE")
  SEQ=$(echo "$line"   | grep -oE 'SEQ=[0-9]+'         | cut -d= -f2)
  NEXT=$(echo "$line"  | grep -oE 'NEXT=[A-Z]+'        | cut -d= -f2)
  CODEX_VOTE=$(echo "$line"  | grep -oE 'CODEX=[A-Z]+' | cut -d= -f2)
  CLAUDE_VOTE=$(echo "$line" | grep -oE 'CLAUDE=[A-Z]+' | cut -d= -f2)
  if [[ -z "$NEXT" ]]; then return 1; fi
  return 0
}

# ── Main loop ────────────────────────────────────────────────────────
log "poll start: agent=$AGENT interval=${INTERVAL}s timeout=${TIMEOUT}s"

PREV_LINE=""
while true; do
  # Timeout check
  if [[ "$TIMEOUT" -gt 0 ]]; then
    NOW=$(date +%s)
    ELAPSED=$(( NOW - START ))
    if [[ "$ELAPSED" -ge "$TIMEOUT" ]]; then
      log "poll timeout after ${ELAPSED}s"
      echo "TIMEOUT"
      exit 1
    fi
  fi

  # Parse
  if ! parse_status; then
    log "ERROR: cannot parse $STATUS_FILE"
    echo "ERROR"
    exit 2
  fi

  CUR_LINE="SEQ=$SEQ NEXT=$NEXT CODEX=$CODEX_VOTE CLAUDE=$CLAUDE_VOTE"

  # Log only on state change
  if [[ "$CUR_LINE" != "$PREV_LINE" ]]; then
    log "$CUR_LINE"
    PREV_LINE="$CUR_LINE"
  fi

  # Check terminal conditions
  if [[ "$NEXT" == "DONE" ]]; then
    log "poll end: DONE"
    echo "DONE"
    exit 0
  fi

  if [[ "$NEXT" == "$AGENT" ]]; then
    log "poll end: YOUR_TURN"
    echo "YOUR_TURN"
    exit 0
  fi

  sleep "$INTERVAL"
done
