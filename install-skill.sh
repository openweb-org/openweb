#!/usr/bin/env bash
# Install/uninstall OpenWeb skill for AI coding agents.
# Auto-detects Claude Code, Codex, OpenCode, OpenClaw.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/openweb-org/openweb/main/install-skill.sh | bash
#   bash install-skill.sh --uninstall

set -euo pipefail

REPO="https://github.com/openweb-org/openweb.git"
SKILL_DIRS=(
  "$HOME/.claude/skills"
  "$HOME/.agents/skills"
  "$HOME/.config/opencode/skills"
  "$HOME/.openclaw/workspace/skills"
)
SKILL_NAMES=("Claude Code" "Codex" "OpenCode" "OpenClaw")
AGENT_CMDS=("claude" "codex" "opencode" "openclaw")

# --- uninstall ---
if [ "${1:-}" = "--uninstall" ]; then
  removed=()
  for i in "${!SKILL_DIRS[@]}"; do
    target="${SKILL_DIRS[$i]}/openweb"
    if [ -d "$target" ]; then
      rm -rf "$target"
      removed+=("${SKILL_NAMES[$i]} → $target")
    fi
  done
  if command -v openweb &>/dev/null; then
    echo "Uninstalling openweb CLI..."
    npm uninstall -g @openweb-org/openweb
    removed+=("CLI → npm global")
  fi
  if [ ${#removed[@]} -eq 0 ]; then
    echo "Nothing to uninstall."
  else
    echo ""
    for line in "${removed[@]}"; do
      echo "  ✗ $line"
    done
  fi
  exit 0
fi
if command -v openweb &>/dev/null; then
  echo "CLI already installed: $(openweb --version 2>/dev/null || echo 'openweb')"
else
  echo "Installing openweb CLI..."
  npm install -g @openweb-org/openweb
fi

# --- resolve skill source ---
if [ -d "skills/openweb" ]; then
  SKILL_SRC="skills/openweb"
  echo "Using local skill source."
else
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "Downloading openweb skill..."
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$TMP/openweb" 2>/dev/null
  git -C "$TMP/openweb" sparse-checkout set skills/openweb 2>/dev/null
  SKILL_SRC="$TMP/openweb/skills/openweb"
fi

# --- install into each detected agent ---
installed=()

for i in "${!AGENT_CMDS[@]}"; do
  if command -v "${AGENT_CMDS[$i]}" &>/dev/null; then
    mkdir -p "${SKILL_DIRS[$i]}"
    cp -Rf "$SKILL_SRC" "${SKILL_DIRS[$i]}/openweb"
    installed+=("${SKILL_NAMES[$i]} → ${SKILL_DIRS[$i]}/openweb")
  fi
done

# Fallback: no agent detected — install for the big three
if [ ${#installed[@]} -eq 0 ]; then
  echo "No agent detected — installing for Claude Code, Codex, and OpenCode."
  for i in 0 1 2; do
    mkdir -p "${SKILL_DIRS[$i]}"
    cp -Rf "$SKILL_SRC" "${SKILL_DIRS[$i]}/openweb"
    installed+=("${SKILL_NAMES[$i]} → ${SKILL_DIRS[$i]}/openweb")
  done
fi

echo ""
for line in "${installed[@]}"; do
  echo "  ✓ $line"
done

echo ""
echo "Add to your project instructions (CLAUDE.md / AGENTS.md):"
echo "  - OpenWeb: Access any website through /openweb"
