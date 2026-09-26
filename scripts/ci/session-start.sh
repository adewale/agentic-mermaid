#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web, registered in
# .claude/settings.json. The cloud base image ships a Bun older than the 1.4.0
# this repository requires (src/mcp/bun-version.ts): older Bun mishandles
# node:vm timeouts, so the MCP server refuses to start and the suite fails.
# Upgrade to the CI pin when the image's Bun is too old, then install the locked
# dependencies. Local sessions are left alone. Stdout becomes session context,
# so only the upgrade notice goes there; tool output goes to stderr.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# src/__tests__/bun-version.test.ts keeps these equal to MIN_BUN_VERSION and to
# the Bun every workflow pins.
MIN_BUN=1.4.0
PIN_BUN=1.4.2

meets_minimum() { [ "$(printf '%s\n%s\n' "$MIN_BUN" "$1" | sort -V | head -n 1)" = "$MIN_BUN" ]; }

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

found="$(bun --version 2>/dev/null || echo 0.0.0)"
if ! meets_minimum "$found"; then
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  curl -fsSL https://bun.sh/install | bash -s "bun-v$PIN_BUN" >&2
  export PATH="$BUN_INSTALL/bin:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "export PATH=\"$BUN_INSTALL/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"; fi
  installed="$(bun --version)"
  meets_minimum "$installed" || { echo "Bun $installed is still below $MIN_BUN after upgrading" >&2; exit 1; }
  echo "Upgraded Bun $found to $installed: this repository needs Bun $MIN_BUN or later."
fi

bun install --frozen-lockfile >&2
