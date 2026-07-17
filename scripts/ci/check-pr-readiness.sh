#!/usr/bin/env bash
# check-pr-readiness.sh
#
# Quick automated checks for common PR issues.
# Run from the root of the repo you're contributing to.
#
# Usage: bash check-pr-readiness.sh [base-branch]

set -euo pipefail

BASE="${1:-main}"
PASS="✓"
WARN="⚠"
FAIL="✗"
FAILURES=0

echo "PR Readiness Check (comparing against $BASE)"
echo "============================================="
echo ""

# Check 1: Diff size
LINES_CHANGED=$(git diff "$BASE"...HEAD --stat | tail -1 | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | grep -oE '[0-9]+' | paste -sd+ - | bc 2>/dev/null || echo "0")
if [ "$LINES_CHANGED" -gt 500 ]; then
    echo "$WARN  Large diff: $LINES_CHANGED lines changed. Consider splitting into smaller PRs."
elif [ "$LINES_CHANGED" -gt 0 ]; then
    echo "$PASS  Diff size: $LINES_CHANGED lines changed"
else
    echo "$FAIL  No changes detected against $BASE"
    FAILURES=$((FAILURES + 1))
fi

# Check 2: Test files modified
TEST_FILES=$(git diff "$BASE"...HEAD --name-only | grep -iE '(test|spec|_test\.|\.test\.)' | wc -l | tr -d ' ' || true)
if [ "$TEST_FILES" -gt 0 ]; then
    echo "$PASS  Test files modified: $TEST_FILES"
else
    echo "$WARN  No test files modified. Does this change need tests?"
fi

# Check 3: Commit count
COMMIT_COUNT=$(git rev-list --count "$BASE"...HEAD 2>/dev/null || echo "0")
echo "$PASS  Commits: $COMMIT_COUNT"

# Check 4: Check for possible secrets in diff
SECRETS=$(git diff "$BASE"...HEAD | grep -iE '(api_key|secret|password|token)\s*=' | head -5 || true)
if [ -n "$SECRETS" ]; then
    echo "$FAIL  Possible secrets in diff:"
    echo "$SECRETS" | sed 's/^/       /'
    FAILURES=$((FAILURES + 1))
else
    echo "$PASS  No obvious secrets in diff"
fi

# Check 5: Console/debug statements
DEBUG=$(git diff "$BASE"...HEAD | grep -E '^\+' | grep -iE '(console\.log|debugger|binding\.pry|import pdb|print\()' | head -5 || true)
if [ -n "$DEBUG" ]; then
    echo "$WARN  Possible debug statements in diff:"
    echo "$DEBUG" | sed 's/^/       /'
else
    echo "$PASS  No debug statements detected"
fi

# Check 6: UI files changed (screenshots needed?)
UI_FILES=$(git diff "$BASE"...HEAD --name-only | grep -iE '\.(jsx|tsx|vue|svelte|css|scss|html|erb)$' | wc -l | tr -d ' ' || true)
if [ "$UI_FILES" -gt 0 ]; then
    echo "$WARN  $UI_FILES UI-related files changed — include captioned before/after screenshots in your PR"
else
    echo "$PASS  No UI files changed"
fi

echo ""
echo "Done. Address any $WARN warnings and $FAIL failures before submitting."
if [ "$FAILURES" -gt 0 ]; then
    exit 1
fi
