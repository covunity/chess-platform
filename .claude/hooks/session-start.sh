#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

npm install

# ── Resume pending loop work ──────────────────────────────────────────────────
STATE_FILE=".claude/loop-state.json"
if [ -f "$STATE_FILE" ]; then
  ACTIVE=$(python3 -c "import json,sys; d=json.load(open('$STATE_FILE')); print(d.get('active','false'))" 2>/dev/null || echo "false")
  if [ "$ACTIVE" = "True" ] || [ "$ACTIVE" = "true" ]; then
    ISSUE=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('issue','?'))" 2>/dev/null || echo "?")
    PR=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('pr','?'))" 2>/dev/null || echo "?")
    STAGE=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('stage','?'))" 2>/dev/null || echo "?")
    NEXT=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('next_action',''))" 2>/dev/null || echo "")
    echo ""
    echo "=========================================="
    echo "LOOP RESUME: pending work detected"
    echo "  Issue : #$ISSUE"
    echo "  PR    : #$PR"
    echo "  Stage : $STAGE"
    echo "  Action: $NEXT"
    echo "=========================================="
    echo ""
  fi
fi
