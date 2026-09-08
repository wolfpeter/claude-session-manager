#!/usr/bin/env bash
# Installs Claude Session Manager as a systemd service.
#   ./install.sh          system service (needs sudo), starts at boot, runs as the current user
#   ./install.sh --user   user service (no sudo); run `loginctl enable-linger $USER` (once, as root) for boot start
set -euo pipefail

cd "$(dirname "$0")"
DIR=$(pwd)
MODE=system
[[ "${1:-}" == "--user" ]] && MODE=user
SERVICE=claude-session-manager

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. prerequisites -----------------------------------------------------------------------------
command -v node >/dev/null || die "node not found. Install Node.js >= 20.6 (https://nodejs.org)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
(( NODE_MAJOR >= 20 )) || die "Node.js >= 20.6 required, found $(node --version)"
command -v npm >/dev/null || die "npm not found"
command -v tmux >/dev/null || die "tmux not found. Install it: sudo apt install tmux"
if ! command -v claude >/dev/null; then
  echo "warning: 'claude' is not on PATH. Sessions will start but Claude Code will not launch." >&2
  echo "         Install it or set CLAUDE_COMMAND in .env to the full path." >&2
fi
command -v gcc >/dev/null || echo "warning: gcc not found; node-pty needs build tools (sudo apt install build-essential python3)" >&2
log "node $(node --version), tmux $(tmux -V | cut -d' ' -f2)"

# 2-4. dependencies + build ---------------------------------------------------------------------
log "Installing dependencies"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
log "Building frontend and backend"
npm run build

# config --------------------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  sed "s|/home/wopi/Projektek|$HOME/Projektek|" .env.example > .env
  log "Created .env from .env.example. Edit ALLOWED_DIRECTORIES there if your projects live elsewhere."
fi

# 5-6. systemd ------------------------------------------------------------------------------------
NODE_BIN=$(command -v node)
# PATH for the service: where node/claude/tmux live now, plus the usual places.
SERVICE_PATH="$HOME/.local/bin:$(dirname "$NODE_BIN")"
command -v claude >/dev/null && SERVICE_PATH="$SERVICE_PATH:$(dirname "$(command -v claude)")"
SERVICE_PATH="$SERVICE_PATH:/usr/local/bin:/usr/bin:/bin"

render() {
  sed -e "s|__USER__|$USER|g" -e "s|__DIR__|$DIR|g" -e "s|__NODE__|$NODE_BIN|g" -e "s|__PATH__|$SERVICE_PATH|g" \
    deploy/$SERVICE.service
}

if [[ $MODE == system ]]; then
  log "Installing system service (sudo)"
  render | sudo tee /etc/systemd/system/$SERVICE.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now $SERVICE
  sudo systemctl restart $SERVICE
  sleep 1
  systemctl --no-pager --lines=5 status $SERVICE || true
else
  log "Installing user service"
  mkdir -p "$HOME/.config/systemd/user"
  render | sed -e '/^User=/d' -e 's/^WantedBy=.*/WantedBy=default.target/' > "$HOME/.config/systemd/user/$SERVICE.service"
  systemctl --user daemon-reload
  systemctl --user enable --now $SERVICE
  systemctl --user restart $SERVICE
  sleep 1
  systemctl --user --no-pager --lines=5 status $SERVICE || true
  echo "Note: a user service only runs while you are logged in unless lingering is enabled:"
  echo "      sudo loginctl enable-linger $USER"
fi

PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
log "Done. Open http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT:-3000}/ (or the Tailscale address)."
