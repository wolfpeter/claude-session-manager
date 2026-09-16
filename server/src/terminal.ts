import { execFile } from "node:child_process";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import { MouseModeFilter } from "./mousemode.js";
import { Tmux } from "./tmux.js";
import type { Logger } from "./sessions.js";
import type { ClientMessage, ServerMessage } from "./types.js";

export interface TerminalOptions {
  cols: number;
  rows: number;
  historyLines: number;
  /** Pass the application's mouse reporting through to the browser (see Config). */
  mouseReporting: boolean;
}

/**
 * TERM for the PTY. tmux-256color (with the matching terminal-overrides, see Tmux.ensureServerOptions)
 * gives scrollback in the browser; if its terminfo is missing we fall back to xterm-256color and lose
 * scrollback rather than break colours.
 */
const browserTerm: Promise<string> = new Promise((resolve) => {
  execFile("infocmp", [Tmux.BROWSER_TERM], (err) => resolve(err ? "xterm-256color" : Tmux.BROWSER_TERM));
});

const MIN_SIZE = 2;
const MAX_SIZE = 1000;

export function clampSize(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number.parseInt(String(n ?? ""), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.floor(v)));
}

/**
 * Bridges one WebSocket to one `tmux attach-session` client running in a PTY.
 * Closing the socket only detaches the tmux client; the session (and Claude inside it) keeps running.
 */
export async function attachTerminal(
  ws: WebSocket,
  tmux: Tmux,
  sessionId: string,
  opts: TerminalOptions,
  log: Logger,
): Promise<void> {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const termName = await browserTerm;
  if (termName !== Tmux.BROWSER_TERM) log.warn({ termName }, "tmux-256color terminfo missing; browser scrollback disabled");

  // Scrollback first, attach second: size the window like this client, send the history above the
  // visible screen, then push it entirely into xterm's scrollback with blank lines so tmux draws the
  // visible screen onto an empty page. No lines lost, none duplicated.
  try {
    await tmux.resizeWindow(sessionId, opts.cols, opts.rows);
    const history = (await tmux.captureHistory(sessionId, opts.historyLines)).replace(/^(\s*\n)+/, "");
    if (history && ws.readyState === ws.OPEN) {
      const lines = history.replace(/\n$/, "").split("\n");
      ws.send(Buffer.from(lines.join("\r\n") + "\r\n".repeat(opts.rows + 1), "utf8"));
    }
  } catch (err) {
    log.warn({ sessionId, err }, "history capture failed");
  }

  let term: pty.IPty;
  try {
    term = pty.spawn(tmux.command, [...tmux.baseArgs(), "attach-session", "-t", `=${sessionId}`], {
      name: termName,
      cols: opts.cols,
      rows: opts.rows,
      cwd: process.env.HOME ?? "/",
      env: { ...process.env, TERM: termName, LANG: process.env.LANG ?? "C.UTF-8" },
    });
  } catch (err) {
    log.error({ sessionId, err }, "failed to spawn tmux attach");
    send({ type: "error", message: "Failed to attach to session" });
    ws.close(1011, "attach failed");
    return;
  }

  send({ type: "ready", id: sessionId });

  // Without this the browser terminal follows Claude into mouse mode, where a drag is sent to
  // Claude instead of selecting text.
  const mouseFilter = opts.mouseReporting ? undefined : new MouseModeFilter();
  term.onData((data) => {
    if (ws.readyState !== ws.OPEN) return;
    const out = mouseFilter ? mouseFilter.push(data) : data;
    if (out) ws.send(Buffer.from(out, "utf8"));
  });

  term.onExit(({ exitCode }) => {
    log.info({ sessionId, exitCode }, "tmux client exited");
    send({ type: "exit", code: exitCode });
    if (ws.readyState === ws.OPEN) ws.close(1000, "session ended");
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      term.write(raw.toString("utf8"));
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString("utf8")) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (msg.type === "resize") {
      const cols = clampSize(msg.cols, opts.cols);
      const rows = clampSize(msg.rows, opts.rows);
      try {
        term.resize(cols, rows);
      } catch (err) {
        log.warn({ sessionId, cols, rows, err }, "resize failed");
      }
    }
  });

  const cleanup = () => {
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  };
  ws.on("close", cleanup);
  ws.on("error", (err) => {
    log.warn({ sessionId, err }, "websocket error");
    cleanup();
  });
}
