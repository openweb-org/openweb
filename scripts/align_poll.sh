#!/usr/bin/env bash
# align_poll.sh — Block until it's YOUR_TURN or DONE.
# Usage: align_poll.sh <status.txt path> <CLAUDE|CODEX>
# Polls every 5 seconds. All poll details go to poll.log next to status.txt.

set -euo pipefail

STATUS_FILE="$1"
AGENT="$2"
LOG_FILE="$(dirname "$STATUS_FILE")/poll.log"

if [[ -z "$STATUS_FILE" || -z "$AGENT" ]]; then
  echo "Usage: align_poll.sh <status.txt> <CLAUDE|CODEX>" >&2
  exit 1
fi

while true; do
  if [[ ! -f "$STATUS_FILE" ]]; then
    echo "$(date '+%H:%M:%S') waiting for $STATUS_FILE" >> "$LOG_FILE"
    sleep 5
    continue
  fi

  LINE=$(head -1 "$STATUS_FILE")

  # Extract NEXT value (macOS-compatible)
  NEXT=$(echo "$LINE" | sed -n 's/.*NEXT=\([^ ]*\).*/\1/p')

  echo "$(date '+%H:%M:%S') NEXT=$NEXT (looking for $AGENT)" >> "$LOG_FILE"

  if [[ "$NEXT" == "DONE" ]]; then
    echo "DONE"
    exit 0
  fi

  if [[ "$NEXT" == "$AGENT" ]]; then
    echo "YOUR_TURN"
    exit 0
  fi

  sleep 5
done
