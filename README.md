# Claude Session Manager

A small web app for running and watching several [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions on one Linux machine, from a phone or a desktop browser.

Each Claude session lives in its own **tmux** session. The web app only attaches to tmux, so closing the browser, losing the phone's connection, or restarting the backend never stops Claude.

```
Browser (xterm.js) ── HTTP + WebSocket ──► Node/Fastify ── node-pty: tmux attach ──► tmux ──► claude
```

Main use case: pick up the phone, open the page, see what the Claudes are doing, tap one, read the terminal, answer if needed.

## Features

- Lists every tmux session whose name starts with `claude-` (also ones you created by hand).
- Starts a new session: creates the tmux session in the chosen project directory and runs `claude` in it.
- Full interactive terminal in the browser: colours, arrows, Ctrl+C, resize; extra key bar on touch screens (Esc, Tab, Shift+Tab, arrows, Ctrl+C).
- Automatic reconnect with the last 200 lines of scrollback, so you never return to an empty screen.
- Stop button ends the tmux session only. Project files are never touched.
- No database: tmux is the source of truth. Session names are stored as a tmux option on the session itself.
- Runs as a systemd service under your own user.

## Requirements

- Linux (developed on Xubuntu), systemd
- Node.js 20.6 or newer (tested with 24), npm
- tmux
- Claude Code CLI (`claude`) installed and logged in for the user that runs the service
- Build tools for `node-pty` (`sudo apt install build-essential python3`)

## Install

```bash
git clone <this repo> ~/Projektek/claude-session-manager
cd ~/Projektek/claude-session-manager
./install.sh            # system service, asks for sudo
# or, without sudo:
./install.sh --user     # user service; add `sudo loginctl enable-linger $USER` for start at boot
```

The script checks Node/tmux/claude, installs dependencies, builds the frontend and backend, writes a `.env` from `.env.example` if none exists, installs the systemd unit and starts it.

Then open `http://<machine>:3000/`. Over Tailscale that is your machine's Tailscale IP or MagicDNS name.

## Update

```bash
cd ~/Projektek/claude-session-manager
./deploy.sh             # git pull, rebuild, restart the service; tmux sessions keep running
```

## Configuration

Settings live in `.env` in the repo root (see `.env.example`). Environment variables override them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address. Use your Tailscale IP to listen only there. |
| `CLAUDE_COMMAND` | `claude` | Command typed into each new tmux session |
| `SESSION_PREFIX` | `claude-` | Only tmux sessions with this prefix are shown and managed |
| `ALLOWED_DIRECTORIES` | `~/Projektek` | Colon-separated roots; sessions can only be started inside these |
| `AUTH_TOKEN` | empty | If set, every API and WebSocket request needs it (`X-Api-Key` header or `?token=`). The UI asks for it once and remembers it. |
| `HISTORY_LINES` | `200` | Scrollback lines sent to the browser on connect |
| `LOG_LEVEL` | `info` | pino log level |
| `TMUX_SOCKET` | empty | Optional `tmux -L` socket name, to keep the manager's sessions on a separate tmux server |

## How it works

- **Discovery**: `tmux list-sessions` with a custom format. Sessions created by the UI carry `@csm_name` (the display name) as a tmux session option; manual sessions fall back to the name without prefix. Status is `running` when the active pane runs `claude`/`node`, `idle` when only the shell is left, `stopped` if the pane is dead.
- **Create**: `tmux new-session -d -s <id> -c <dir>` then `tmux send-keys -l "<CLAUDE_COMMAND>" Enter`. The id is a slug of the name (`API refactor` becomes `claude-api-refactor`, `-2`, `-3` on collisions). The status bar is turned off for these sessions to save a row on phones; run `tmux set -t <id> status on` to bring it back.
- **Terminal**: each WebSocket spawns `tmux attach-session -t =<id>` inside a PTY (node-pty). Browser input goes to the PTY, PTY output goes back as binary frames. Resizes resize the PTY, tmux picks them up. The tmux server option `window-size latest` makes the window follow the most recently active client, so a phone does not shrink the desktop view.
- **Reconnect**: the browser retries with backoff (and immediately when the tab becomes visible). On connect the server sends the tmux scrollback, then tmux redraws the visible screen.
- **Backend restarts**: the systemd unit uses `KillMode=process`, so stopping or restarting the service only kills Node; the tmux server started from it stays alive and is rediscovered on start.

## Security notes

- The app is meant for a private network (Tailscale). There is no login by default; set `AUTH_TOKEN` for a shared secret, and put a reverse proxy with TLS in front if you expose it more widely.
- No shell string is ever built from user input: tmux is always called via `execFile` with an argument array.
- Session ids must match `<prefix>[a-z0-9_-]+`; working directories are resolved with `realpath` and must be inside `ALLOWED_DIRECTORIES` (symlink escapes are rejected).
- `DELETE /api/sessions/:id` only kills the tmux session.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | `{ "name", "workingDirectory" }` creates a session and starts Claude, returns 201 |
| `GET` | `/api/sessions/:id` | One session |
| `DELETE` | `/api/sessions/:id` | Stop the tmux session, returns 204 |
| `GET` | `/api/config` | Allowed directories and prefix (for the form) |
| `GET` | `/api/health` | `{ "ok": true }` |
| `WS` | `/ws/sessions/:id?cols=&rows=` | Terminal. Client sends JSON `{type:"input",data}` / `{type:"resize",cols,rows}`; server sends binary terminal output and JSON `{type:"ready"|"exit"|"error"}` |

## Development

```bash
npm install
npm run dev        # backend on :3000 (tsx watch) + Vite dev server on :5173 with proxy
npm test           # unit + integration tests (the integration tests start a private tmux server)
npm run typecheck
npm run build
```

Layout:

```
server/src/config.ts      env parsing
server/src/tmux.ts        tmux CLI wrapper (execFile only)
server/src/sessions.ts    discovery, create, remove
server/src/terminal.ts    WebSocket <-> node-pty <-> tmux attach
server/src/app.ts         Fastify routes, auth hook, static frontend
web/src/                  React + xterm.js UI (list, new-session form, terminal)
deploy/                   systemd unit template
```

## Troubleshooting

- **Claude does not start in new sessions**: the service's PATH is set by `install.sh` from where `node`, `claude` and `tmux` were found at install time. If you move them, re-run `./install.sh`, or set `CLAUDE_COMMAND` to a full path.
- **Sessions from my desktop terminal are missing**: they must be named `claude-...` (or your `SESSION_PREFIX`) and live on the same tmux server (default socket) as the service. Check with `tmux ls`.
- **Terminal looks squashed after opening on the phone**: focus the desktop view again; `window-size latest` follows the last active client.

## Later ideas (not in the MVP)

Finer status (working / waiting for input), push notification when Claude waits, git branch info per session, rename, model and permission-mode selection when starting, HTTPS.
