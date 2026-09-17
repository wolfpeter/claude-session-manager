#!/usr/bin/env bash
# Update an existing installation: pull, rebuild, restart the service. tmux sessions keep running.
set -euo pipefail
cd "$(dirname "$0")"
SERVICE=claude-session-manager

git pull --ff-only
# --include=dev because the build needs vite and tsc: this runs with NODE_ENV=production
# whenever it is started from the service (the update button's tmux session inherits it),
# and npm would then skip every devDependency and fail with "vite: not found".
if [[ -f package-lock.json ]]; then npm ci --include=dev; else npm install --include=dev; fi
npm run build

if systemctl --user list-unit-files "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then
  systemctl --user restart $SERVICE && systemctl --user --no-pager --lines=3 status $SERVICE
elif systemctl list-unit-files "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then
  sudo systemctl restart $SERVICE && systemctl --no-pager --lines=3 status $SERVICE
else
  echo "Service not installed; run ./install.sh first." >&2
  exit 1
fi
