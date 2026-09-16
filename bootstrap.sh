#!/usr/bin/env bash
# One-command install of Claude Session Manager on a fresh Linux machine:
# checks what is missing, offers to install it, clones the repo, then runs install.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/__REPO__/main/bootstrap.sh | bash
#
# Environment overrides:
#   CSM_DIR=~/apps/csm        where to clone (default: ~/Projektek/claude-session-manager)
#   CSM_REPO=<git url>        clone from elsewhere, e.g. a fork or a local path
#   CSM_BRANCH=main           branch to check out
#   CSM_SERVICE=system|user|none   systemd mode (default: system); "none" installs and builds only
#   CSM_YES=1                 do not ask before installing system packages
set -euo pipefail

REPO=${CSM_REPO:-https://github.com/__REPO__.git}
BRANCH=${CSM_BRANCH:-main}
DIR=${CSM_DIR:-$HOME/Projektek/claude-session-manager}
SERVICE_MODE=${CSM_SERVICE:-system}

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "This installs a systemd service, so it needs Linux."

# ---- what is missing? -------------------------------------------------------------------------
node_ok() { command -v node >/dev/null && (( $(node -p 'process.versions.node.split(".")[0]') >= 20 )); }

MISSING=()
command -v git >/dev/null || MISSING+=(git)
command -v tmux >/dev/null || MISSING+=(tmux)
node_ok || MISSING+=(node)
command -v gcc >/dev/null || MISSING+=(buildtools)   # node-pty is compiled from source

# ---- package manager --------------------------------------------------------------------------
if command -v apt-get >/dev/null; then PM=apt
elif command -v dnf >/dev/null; then PM=dnf
elif command -v pacman >/dev/null; then PM=pacman
elif command -v zypper >/dev/null; then PM=zypper
else PM=""
fi

# Package names differ per distro; node is special because distro versions are often too old.
pkg_for() {
  case "$1:$PM" in
    git:*) echo git ;;
    tmux:*) echo tmux ;;
    buildtools:apt) echo "build-essential python3" ;;
    buildtools:dnf) echo "gcc-c++ make python3" ;;
    buildtools:pacman) echo "base-devel python" ;;
    buildtools:zypper) echo "gcc-c++ make python3" ;;
    node:apt|node:dnf) echo "nodejs" ;;
    node:pacman) echo "nodejs npm" ;;
    node:zypper) echo "nodejs22 npm22" ;;
    *) echo "" ;;
  esac
}

sudo_run() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

install_missing() {
  local pkgs=() item
  for item in "${MISSING[@]}"; do
    [[ $item == node ]] && continue   # handled separately: needs a recent release
    pkgs+=($(pkg_for "$item"))
  done

  local needs_nodesource=0
  if [[ " ${MISSING[*]} " == *" node "* ]]; then
    if [[ $PM == apt || $PM == dnf ]]; then needs_nodesource=1; else pkgs+=($(pkg_for node)); fi
  fi

  log "Missing on this machine: ${MISSING[*]}"
  echo "    packages to install: ${pkgs[*]:-(none)}"
  (( needs_nodesource )) && echo "    plus Node.js 22 from deb.nodesource.com / rpm.nodesource.com"
  echo "    with: sudo (you may be asked for your password)"

  if [[ ${CSM_YES:-} != 1 ]]; then
    # When piped from curl, stdin is the script itself; read the answer from the terminal.
    local answer
    read -r -p "Install these now? [Y/n] " answer </dev/tty || die "No terminal to ask on; re-run with CSM_YES=1."
    [[ ${answer:-y} =~ ^[Yy]?$ ]] || die "Nothing installed. Install the packages above, then re-run."
  fi

  case $PM in
    apt) sudo_run apt-get update -qq; (( ${#pkgs[@]} )) && sudo_run apt-get install -y "${pkgs[@]}" ;;
    dnf) (( ${#pkgs[@]} )) && sudo_run dnf install -y "${pkgs[@]}" ;;
    pacman) (( ${#pkgs[@]} )) && sudo_run pacman -Sy --needed --noconfirm "${pkgs[@]}" ;;
    zypper) (( ${#pkgs[@]} )) && sudo_run zypper --non-interactive install "${pkgs[@]}" ;;
  esac

  if (( needs_nodesource )); then
    log "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>/dev/null ||
      curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
    sudo_run bash /tmp/nodesource_setup.sh
    rm -f /tmp/nodesource_setup.sh
    [[ $PM == apt ]] && sudo_run apt-get install -y nodejs || sudo_run dnf install -y nodejs
  fi

  node_ok || die "Node.js >= 20 still not available; install it by hand and re-run."
}

if (( ${#MISSING[@]} )); then
  [[ -n $PM ]] || die "Missing: ${MISSING[*]} - and no known package manager here. Install them, then re-run."
  install_missing
fi
log "node $(node --version), tmux $(tmux -V | cut -d' ' -f2), git $(git --version | cut -d' ' -f3)"

# Claude Code itself: the sessions are useless without it, but it is not our package to force.
if ! command -v claude >/dev/null; then
  warn "Claude Code ('claude') is not on PATH. Install it with: npm install -g @anthropic-ai/claude-code"
  warn "and log in once with 'claude' before starting a session from the web UI."
fi

# ---- clone or update --------------------------------------------------------------------------
if [[ -d $DIR/.git ]]; then
  log "Updating existing checkout in $DIR"
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" merge --ff-only --quiet "origin/$BRANCH"
else
  [[ -e $DIR ]] && die "$DIR exists but is not a git checkout. Move it away or set CSM_DIR."
  log "Cloning into $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi

# ---- hand over to the installer ----------------------------------------------------------------
cd "$DIR"
case $SERVICE_MODE in
  system) ./install.sh ;;
  user) ./install.sh --user ;;
  none) ./install.sh --no-service ;;
  *) die "CSM_SERVICE must be system, user or none (got: $SERVICE_MODE)" ;;
esac
