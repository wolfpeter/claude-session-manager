# Claude Session Manager

A small web app for running and watching several [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions on one Linux machine, from a phone or a desktop browser.

Each Claude session lives in its own **tmux** session. The web app only attaches to tmux, so closing the browser, losing the phone's connection, or restarting the backend never stops Claude.

```
Browser (xterm.js) ── HTTP + WebSocket ──► Node/Fastify ── node-pty: tmux attach ──► tmux ──► claude
```

Main use case: pick up the phone, open the page, see what the Claudes are doing, tap one, read the terminal, answer if needed.

## Features

- Lists every tmux session whose name starts with `claude-` (also ones you created by hand).
- Shows at a glance what each session is doing: working, needs you (question, permission request, folder trust), waiting for you, may be stuck, or shell only. Sessions that need an answer sort to the top and their count appears in the tab title, so the phone shows it without opening anything.
- Starts a new session: creates the tmux session in the chosen project directory and runs `claude` in it.
- Full interactive terminal in the browser: colours, arrows, Ctrl+C, resize; extra key bar on touch screens (Esc, Tab, Shift+Tab, arrows, Ctrl+C).
- Automatic reconnect with the last 200 lines of scrollback, so you never return to an empty screen.
- URLs in the output are tappable and open in a new tab (login links from `gcloud auth login --no-launch-browser` and similar flows).
- Copy on select in the terminal: let go of a drag and the text is already on the clipboard, the way a terminal emulator does it. A small copy button appears next to a selection and copies it again, for the rare case where the browser refuses the automatic one. Both fall back to the old `execCommand` route because `navigator.clipboard` does not exist over plain HTTP on a LAN or Tailscale address.
- Stop button ends the tmux session only. Project files are never touched.
- Update button in the list header: says whether the checkout is behind its remote, and starts `deploy.sh` in a tmux session you watch in the browser (see below).
- Claude Code processes started in ordinary terminals (outside tmux) are listed too, read-only: the browser cannot attach to them, but you see where they run and for how long.
- No database: tmux is the source of truth. Session names are stored as a tmux option on the session itself.
- Runs as a systemd service under your own user.

## Requirements

- Linux (developed on Xubuntu), systemd
- Node.js 20.6 or newer (tested with 24), npm
- tmux
- Claude Code CLI (`claude`) installed and logged in for the user that runs the service
- Build tools for `node-pty` (`sudo apt install build-essential python3`)

## Install

On a fresh machine, one command does everything:

```bash
curl -fsSL https://raw.githubusercontent.com/wolfpeter/claude-session-manager/main/bootstrap.sh | bash
```

It lists what is missing (git, tmux, Node.js 20+, build tools for `node-pty`), asks once before installing those system packages, clones the repo to `~/claude-session-manager`, then runs `install.sh`. Claude Code itself is not installed for you: if `claude` is not on PATH it says so, and `npm install -g @anthropic-ai/claude-code` plus one interactive `claude` login is all it needs.

Environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CSM_DIR` | `~/claude-session-manager` | Where to clone |
| `CSM_REPO` | this repo | Clone from a fork or a local path instead |
| `CSM_BRANCH` | `main` | Branch to check out |
| `CSM_SERVICE` | `system` | `user` for a user service, `none` to build without systemd |
| `CSM_YES` | unset | Skip the question before installing system packages |
| `CSM_ALLOWED_DIRS` | `$HOME` | What goes into `ALLOWED_DIRECTORIES` |
| `CSM_NO_TOKEN` | unset | Leave `AUTH_TOKEN` empty instead of generating one |
| `CSM_PORT` | `31415` | HTTP port; if it is taken, the installer moves up until it finds a free one |

If you already have the checkout, `install.sh` is the same thing without the cloning:

```bash
./install.sh              # system service, asks for sudo
./install.sh --user       # user service; add `sudo loginctl enable-linger $USER` for start at boot
./install.sh --no-service # dependencies, build and .env only
```

It checks Node/tmux/claude, installs dependencies, builds the frontend and backend, writes a `.env` if none exists (with a generated `AUTH_TOKEN`, printed at the end - the service listens on every interface and whoever reaches it gets a shell through Claude), installs the systemd unit and starts it.

Then open `http://<machine>:31415/`. Over Tailscale that is your machine's Tailscale IP or MagicDNS name.

## Update

```bash
cd ~/claude-session-manager
./deploy.sh             # git pull, rebuild, restart the service; tmux sessions keep running
```

## Configuration

Settings live in `.env` in the repo root (see `.env.example`). Environment variables override them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `31415` | HTTP port. Picked to stay clear of the usual 3000/8000/8080 crowd and of Linux's ephemeral range (32768-60999), so nothing else grabs it first. |
| `HOST` | `0.0.0.0` | Bind address. Use your Tailscale IP to listen only there. |
| `CLAUDE_COMMAND` | `claude` | Command typed into each new tmux session |
| `SESSION_PREFIX` | `claude-` | Only tmux sessions with this prefix are shown and managed |
| `ALLOWED_DIRECTORIES` | `$HOME` | Colon-separated roots; sessions can only be started inside these |
| `AUTH_TOKEN` | empty | If set, every API and WebSocket request needs it (`X-Api-Key` header or `?token=`). The UI asks for it once and remembers it. |
| `HISTORY_LINES` | `200` | Scrollback lines sent to the browser on connect |
| `STALL_SECONDS` | `120` | A busy-looking session with no output for this long is shown as "May be stuck" |
| `BROWSER_MOUSE_REPORTING` | `off` | `on` passes the application's mouse reporting to the browser: you can click inside Claude's UI, but a drag no longer selects text (Shift+drag does) |
| `UPDATE_BRANCH` | `main` | Branch the update button follows |
| `UPDATE_CHECK_MINUTES` | `15` | How often the remote is fetched to see whether an update is waiting; `0` disables the check |
| `REPO_ROOT` | the checkout this runs from | Where the update button runs `deploy.sh` |
| `LOG_LEVEL` | `info` | pino log level |
| `TMUX_SOCKET` | empty | Optional `tmux -L` socket name, to keep the manager's sessions on a separate tmux server |

## How it works

- **Discovery**: one `tmux list-sessions` call with a custom format. Sessions created by the UI carry `@csm_name` (the display name) as a tmux session option, read straight from the format; manual sessions fall back to the name without prefix.
- **Status**: the pane is not enough to tell "thinking" from "waiting", so for every session the server also captures the *visible* screen (`capture-pane`, no scrollback: an old prompt left in the history would be mistaken for the current state) and classifies it in `server/src/status.ts`:

  | Status | What the pane shows |
  | --- | --- |
  | `needs_input` | a blocking prompt: a question menu, `Do you want to proceed?`, or the folder trust dialog |
  | `running` | Claude's spinner line, e.g. `✽ Brewing… (2m 0s · ↓ 8.9k tokens)`. Its elapsed time keeps counting while a **subagent** or a long tool call runs, so a session with a subagent working is never mistaken for a stopped one |
  | `stalled` | a spinner, but the visible screen has not changed for `STALL_SECONDS` |
  | `waiting` | the empty input box, no spinner: the turn ended |
  | `idle` / `stopped` | the pane is back to a plain shell / the pane is dead |

  Two clocks are kept per session in memory (`SessionWatch`), because tmux cannot answer either question:

  - *Is the session alive?* Not `#{session_activity}`: tmux only advances that while a client is attached, so a session nobody is watching - the normal case for this dashboard - would look frozen after a minute. Instead each poll fingerprints the captured screen; a changed screen means Claude is alive, an unchanged one is what `STALL_SECONDS` counts.
  - *How long has it needed me?* Measured from the status change, not from the last output: Claude keeps redrawing its input box while it waits.

  Both are in memory only, so after a backend restart every session starts counting from the restart.

  The classifier is a pure function over captured pane text; `server/test/status.test.ts` runs it against real captures in `server/test/fixtures/`. When a future Claude Code version changes its UI, re-capture a fixture (`tmux capture-pane -p -J -t '=claude-x:'`) and adjust the patterns there.
- **Create**: `tmux new-session -d -s <id> -c <dir>` then `tmux send-keys -l "<CLAUDE_COMMAND>" Enter`. The id is a slug of the name (`API refactor` becomes `claude-api-refactor`, `-2`, `-3` on collisions). The status bar is turned off for these sessions to save a row on phones; run `tmux set -t <id> status on` to bring it back.
- **Terminal**: each WebSocket spawns `tmux attach-session -t =<id>` inside a PTY (node-pty). Browser input goes to the PTY, PTY output goes back as binary frames. Resizes resize the PTY, tmux picks them up. The tmux server option `window-size latest` makes the window follow the most recently active client, so a phone does not shrink the desktop view.
- **Reconnect**: the browser retries with backoff (and immediately when the tab becomes visible). On connect the server sends the tmux scrollback, then tmux redraws the visible screen.
- **Scrollback on the phone**: browser clients attach with `TERM=tmux-256color`, and the server adds `tmux-256color:smcup@:rmcup@` to the tmux `terminal-overrides` option. Without the alternate screen, lines scrolling off the top stay in xterm.js scrollback, so swiping up in the terminal scrolls history (the page itself never scrolls, so no pull-to-refresh). Desktop tmux clients use a different TERM and are not affected.
- **Backend restarts**: the systemd unit uses `KillMode=process`, so stopping or restarting the service only kills Node; the tmux server started from it stays alive and is rediscovered on start.

## Selecting text in the browser

Claude Code turns on the terminal's mouse reporting (any-event + SGR), which tells a terminal to hand every click and drag to the application. In a browser that means no text selection and therefore nothing to copy - Shift+drag is the usual escape hatch, and on a touch screen there is none at all.

Since a browser client gets nothing useful out of mouse reporting anyway, the server removes those mode sequences from the stream it sends to the browser (`server/src/mousemode.ts`), including ones split across chunks. xterm then stays in plain mode and a drag selects text like anywhere else; tmux, Claude and local terminal clients are untouched, since only this client's copy of the stream is filtered. Set `BROWSER_MOUSE_REPORTING=on` to get the old behaviour back.

## Updating from the browser

The update button starts `deploy.sh` in a tmux session and opens it, instead of running the update inside the service. That is not indirection for its own sake:

- The update ends by restarting this very service. A process cannot outlive its own restart, but a tmux session can - `KillMode=process` keeps tmux running - so the output stays readable across it, and the browser reconnects on its own.
- The restart needs a password, and the web-facing process must not have one. In a terminal a person answers the sudo prompt, which keeps a human check on "pull code from the internet and restart".
- If anything fails - a dirty checkout, a build error - you are looking at the terminal that says why.

One caveat: if the machine reboots and the *service* is what starts the tmux server, that server inherits `NoNewPrivileges=yes` from the unit and `sudo` inside it cannot ask for a password at all. Starting tmux from a normal terminal once (or running the update from a desktop terminal) avoids it.

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
| `GET` | `/api/external` | Claude processes running outside tmux (pid, tty, cwd, uptime), read-only |
| `GET` | `/api/update` | Whether the checkout is behind its remote (`{supported, available, behind, current, branch, dirty, checkedAt}`) |
| `POST` | `/api/update` | Starts `deploy.sh` in a tmux session, returns `{ "id" }` to attach to |
| `GET` | `/api/config` | Allowed directories and prefix (for the form) |
| `GET` | `/api/health` | `{ "ok": true }` |
| `WS` | `/ws/sessions/:id?cols=&rows=` | Terminal. Client sends JSON `{type:"input",data}` / `{type:"resize",cols,rows}`; server sends binary terminal output and JSON `{type:"ready"|"exit"|"error"}` |

## Development

```bash
npm install
npm run dev        # backend on :31415 (tsx watch) + Vite dev server on :5173 with proxy
npm test           # unit + integration tests (the integration tests start a private tmux server)
npm run typecheck
npm run build
```

The service itself runs on Node 20.6+, but the test runner (vitest 5) needs Node 22+; on an older Node `npm install` prints an EBADENGINE warning and only `npm test` is affected.

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
- **Sessions from my desktop terminal are missing**: only tmux sessions named `claude-...` (or your `SESSION_PREFIX`) on the same tmux server (default socket) can be opened. Check with `tmux ls`. A `claude` started in a plain terminal shows up under "Running outside tmux" but cannot be attached to; to carry it on from the phone, exit it, start a session in the same directory from the UI and run `/resume` in Claude.
- **Start Claude in tmux from a desktop terminal** so it is manageable later: `tmux new -s claude-myproject -c ~/projects/myproject` then run `claude` inside.
- **Terminal looks squashed after opening on the phone**: focus the desktop view again; `window-size latest` follows the last active client.

## Later ideas

Push notification when a session starts waiting (the state is already known; only the delivery is missing), the pending question shown in the list, quick replies from the list, git branch info per session, rename, model and permission-mode selection when starting, HTTPS.

## License

MIT, see [LICENSE](LICENSE).
