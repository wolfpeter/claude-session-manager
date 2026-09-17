#!/usr/bin/env bash
# Installs Claude Session Manager as a systemd service.
#   ./install.sh               system service (needs sudo), starts at boot, runs as the current user
#   ./install.sh --user        user service (no sudo); run `loginctl enable-linger $USER` (once, as root) for boot start
#   ./install.sh --no-service  dependencies, build and .env only; no systemd
#
# Environment overrides for the generated .env (only used when there is no .env yet):
#   CSM_ALLOWED_DIRS=/srv/code   colon-separated roots sessions may be started in
#   CSM_PORT=8123                HTTP port (default 31415; the next free one is used if taken)
#   CSM_NO_TOKEN=1               leave AUTH_TOKEN empty instead of generating one
set -euo pipefail

cd "$(dirname "$0")"
DIR=$(pwd)
MODE=system
case "${1:-}" in
  --user) MODE=user ;;
  --no-service) MODE=none ;;
  "") ;;
  *) echo "unknown option: $1 (expected --user or --no-service)" >&2; exit 2 ;;
esac
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
# --include=dev because the build needs vite and tsc: this runs with NODE_ENV=production
# whenever it is started from the service (the update button's tmux session inherits it),
# and npm would then skip every devDependency and fail with "vite: not found".
if [[ -f package-lock.json ]]; then npm ci --include=dev; else npm install --include=dev; fi
log "Building frontend and backend"
npm run build

# config --------------------------------------------------------------------------------------
# Node is already a hard requirement, so it is the most portable way to ask "can I bind this?".
port_free() {
  node -e 'const net=require("net");const s=net.createServer();s.once("error",()=>process.exit(1));
           s.listen(Number(process.argv[1]),"0.0.0.0",()=>s.close(()=>process.exit(0)))' "$1" 2>/dev/null
}

if [[ ! -f .env ]]; then
  # Where sessions may be started: the caller's choice, else the home directory.
  ALLOWED=${CSM_ALLOWED_DIRS:-$HOME}
  # A token by default: the service listens on every interface, and anyone who reaches it gets a
  # shell through Claude. Empty it in .env if the machine is truly private.
  if [[ ${CSM_NO_TOKEN:-} == 1 ]]; then TOKEN=""
  else TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  fi
  # A busy port is the one failure systemd reports as a bare "status=1/FAILURE", so find a free
  # one now instead of letting the service crash-loop after the install says "Done".
  WANT_PORT=${CSM_PORT:-$(grep -E '^PORT=' .env.example | cut -d= -f2)}
  PORT=$WANT_PORT
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    port_free "$PORT" && break
    PORT=$((PORT + 1))
  done
  [[ $PORT == "$WANT_PORT" ]] || warn_port="port $WANT_PORT is taken, using $PORT instead"

  sed -e "s|^PORT=.*|PORT=$PORT|" -e "s|^ALLOWED_DIRECTORIES=.*|ALLOWED_DIRECTORIES=$ALLOWED|" \
      -e "s|^AUTH_TOKEN=.*|AUTH_TOKEN=$TOKEN|" .env.example > .env
  chmod 600 .env
  log "Created .env (PORT=$PORT, ALLOWED_DIRECTORIES=$ALLOWED)"
  [[ -n ${warn_port:-} ]] && echo "    ${warn_port}"
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

if [[ $MODE == none ]]; then
  log "Skipping systemd (--no-service). Start it by hand with: npm start"
elif [[ $MODE == system ]]; then
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
TOKEN=$(grep -E '^AUTH_TOKEN=' .env | cut -d= -f2-)
log "Done. Open http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT:-31415}/ (or the Tailscale address)."
if [[ -n $TOKEN ]]; then
  echo "    Access token (the page asks for it once, it is in .env):"
  echo "    $TOKEN"
fi
