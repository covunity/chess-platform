#!/usr/bin/env bash
# Test suite for issue #1: Migrate skills from .agents to .claude directory
# Run from repo root: bash scripts/test-skills-migration.sh

set -euo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0

assert_real_file() {
    local path="$1"
    if [ -f "$path" ] && [ ! -L "$path" ]; then
        echo "PASS: $path is a real file"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $path should be a real file (not a symlink or missing)"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_exists() {
    local path="$1"
    if [ ! -e "$path" ]; then
        echo "PASS: $path does not exist"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $path should not exist but does"
        FAIL=$((FAIL + 1))
    fi
}

assert_file_contains() {
    local path="$1"
    local text="$2"
    if grep -q "$text" "$path" 2>/dev/null; then
        echo "PASS: $path contains expected content"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $path should contain '$text'"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== Skills Migration Tests ==="
echo ""

# Each .claude/skills/*.md must be a real file (not a symlink)
assert_real_file ".claude/skills/tdd.md"
assert_real_file ".claude/skills/grill-with-docs.md"
assert_real_file ".claude/skills/setup-matt-pocock-skills.md"
assert_real_file ".claude/skills/to-issues.md"
assert_real_file ".claude/skills/to-prd.md"

# Spot-check content so the files aren't empty
assert_file_contains ".claude/skills/tdd.md" "Test-Driven Development"
assert_file_contains ".claude/skills/grill-with-docs.md" "grill-with-docs"
assert_file_contains ".claude/skills/setup-matt-pocock-skills.md" "setup-matt-pocock-skills"
assert_file_contains ".claude/skills/to-issues.md" "to-issues"
assert_file_contains ".claude/skills/to-prd.md" "to-prd"

# .agents directory must be gone
assert_not_exists ".agents"

# skills-lock.json must be gone
assert_not_exists "skills-lock.json"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
