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

# Every setting has a fallback, so a .env written by an older install keeps working - and a new
# feature quietly stays off (CLAUDE_PROFILES missing is why the start-profile dropdown offers only
# "Default"). List what is new instead of editing a file that holds this machine's token.
if [[ -f .env && -f .env.example ]]; then
  new_settings=()
  while IFS= read -r line; do
    grep -qE "^[[:space:]]*${line%%=*}=" .env || new_settings+=("$line")
  done < <(grep -E '^[A-Z_]+=' .env.example)
  if (( ${#new_settings[@]} > 0 )); then
    echo
    echo "Settings this .env does not have yet (their defaults are in use until you add them):"
    printf '    %s\n' "${new_settings[@]}"
    echo "  -> add the lines you want to .env, then run this script again."
    echo
  fi
fi

# Restarting a system service the obvious way - sudo systemctl restart - cannot work from the
# update button: it runs this script in a tmux session inside the service's own cgroup, where
# NoNewPrivileges=yes stops sudo from ever becoming root ("the no new privileges flag is set").
# The service runs as us, though, so ending its main process is enough: Restart=always in the unit
# brings the new build back a few seconds later, and KillMode=process leaves this tmux alive.
restart_system_service() {
  local pid owner
  pid=$(systemctl show -p MainPID --value $SERVICE 2>/dev/null || true)
  owner=$(ps -o uid= -p "${pid:-0}" 2>/dev/null | tr -d ' ' || true)
  if [[ ${pid:-0} -gt 0 && ${owner:-} == "$(id -u)" ]] && kill "$pid" 2>/dev/null; then
    echo "Stopped the running server (pid $pid); systemd starts the new build in a moment."
    for _ in $(seq 60); do
      sleep 0.5
      local now
      now=$(systemctl show -p MainPID --value $SERVICE 2>/dev/null || echo 0)
      [[ ${now:-0} -gt 0 && $now != "$pid" ]] && return 0
    done
    echo "warning: the service has not come back after 30s; see the status below." >&2
    return 0
  fi
  echo "Cannot restart $SERVICE from here: it is stopped, or it runs as another user." >&2
  echo "Run this in a terminal on this machine:  sudo systemctl restart $SERVICE" >&2
  return 1
}

if systemctl --user list-unit-files "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then
  systemctl --user restart $SERVICE && systemctl --user --no-pager --lines=3 status $SERVICE
elif systemctl list-unit-files "$SERVICE.service" 2>/dev/null | grep -q "$SERVICE"; then
  restart_system_service
  systemctl --no-pager --lines=3 status $SERVICE
else
  echo "Service not installed; run ./install.sh first." >&2
  exit 1
fi
