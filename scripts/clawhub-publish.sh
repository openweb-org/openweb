#!/usr/bin/env bash
# Publish skills/openweb to ClawHub.
# Requires: `clawhub` CLI installed (`npm install -g clawhub`) and logged in (`clawhub login`).
# Reads version from package.json. Pass changelog as $1, or it falls back to the latest commit subject.
#
# Usage:
#   bash scripts/clawhub-publish.sh "Changelog text here"
#   bash scripts/clawhub-publish.sh                       # uses last commit subject

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v clawhub >/dev/null 2>&1; then
  echo "clawhub CLI not found. Install: npm install -g clawhub" >&2
  exit 1
fi

if ! clawhub whoami >/dev/null 2>&1; then
  echo "Not logged in to ClawHub. Run: clawhub login" >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
CHANGELOG="${1:-$(git log -1 --pretty=%s)}"

echo "Publishing openweb@${VERSION} to ClawHub"
echo "Changelog: ${CHANGELOG}"
echo

clawhub publish skills/openweb \
  --slug openweb \
  --name OpenWeb \
  --version "${VERSION}" \
  --tags latest \
  --changelog "${CHANGELOG}"
