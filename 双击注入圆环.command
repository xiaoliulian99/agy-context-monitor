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

"$NODE_BIN" "$(pwd)/injector/install.js" "$@"
ERR=$?
if [ "$ERR" != "0" ]; then
  echo
  echo "[X] Inject failed. See inject.log"
  read -r -p "Press Enter to close..."
  exit 1
fi
read -r -p "Press Enter to close..."
