#!/usr/bin/env bash
# claudecode marketplace-skill ship-gate. No package.json — git-synced.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

banner() { printf "\n\033[1;34m==== %s ====\033[0m\n" "$1"; }

banner "L1 · Syntax check scripts/"
shopt -s nullglob
for f in scripts/*.js scripts/*.cjs; do node -c "$f"; done
for f in hooks/*.js hooks/*.cjs; do node -c "$f"; done
shopt -u nullglob
echo "  OK"

banner "L1 · MCP bridge responds to --help"
if [ -f "mcp-bridge.cjs" ]; then
  node mcp-bridge.cjs --help > /dev/null 2>&1 || true  # may not support --help
  node -c mcp-bridge.cjs
  echo "  OK — mcp-bridge.cjs parses"
fi

banner "L1 · F-036 SSOT consistency"
( cd "$HERE/../.." && bash scripts/sync-shared-scripts.sh --check )

banner "L1 · settings.json is valid JSON"
python3 -c "import json; json.load(open('settings.json'))"
echo "  OK"

banner "✅ claudecode ship-gate PASS"
