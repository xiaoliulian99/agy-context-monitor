#!/bin/bash
set -u
cd "$(dirname "$0")"
LOG="$(pwd)/inject.log"

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN="/opt/homebrew/bin/node"
elif [ -x /usr/local/bin/node ]; then
  NODE_BIN="/usr/local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  echo "[X] Node.js not found. Install LTS: https://nodejs.org/"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Node.js not found" >>"$LOG"
  read -r -p "Press Enter to close..."
  exit 1
fi

echo
echo "Injecting context ring. Antigravity will be closed."
echo "Log: \"$LOG\""
echo
RUN="${TMPDIR:-/tmp}/agy-context-inject-run.log"
{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') inject ===="
  echo "NODE_BIN=$NODE_BIN"
  "$NODE_BIN" "$(pwd)/injector/install.js" "$@"
} >"$RUN" 2>&1
ERR=$?
cat "$RUN"
cat "$RUN" >>"$LOG"
if [ "$ERR" != "0" ]; then
  echo
  echo "[X] Inject failed. See inject.log"
  read -r -p "Press Enter to close..."
  exit 1
fi
echo
echo "[OK] Injected. Open Antigravity; ring should appear left of the mic."
echo
read -r -p "Press Enter to close..."
