#!/usr/bin/env bash
# Update an existing installation: pull, rebuild, restart the service. tmux sessions keep running.
set -euo pipefail
cd "$(dirname "$0")"
SERVICE=claude-session-manager

git pull --ff-only
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
npm run build

if systemctl --user list-unit-files "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then
  systemctl --user restart $SERVICE && systemctl --user --no-pager --lines=3 status $SERVICE
elif systemctl list-unit-files "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then
  sudo systemctl restart $SERVICE && systemctl --no-pager --lines=3 status $SERVICE
else
  echo "Service not installed; run ./install.sh first." >&2
  exit 1
fi
