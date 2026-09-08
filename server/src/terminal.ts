import * as pty from "node-pty";
import type { WebSocket } from "ws";
import type { Tmux } from "./tmux.js";
import type { Logger } from "./sessions.js";
import type { ClientMessage, ServerMessage } from "./types.js";

export interface TerminalOptions {
  cols: number;
  rows: number;
  historyLines: number;
}

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
export function attachTerminal(
  ws: WebSocket,
  tmux: Tmux,
  sessionId: string,
  opts: TerminalOptions,
  log: Logger,
): void {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  let term: pty.IPty;
  try {
    term = pty.spawn(tmux.command, [...tmux.baseArgs(), "attach-session", "-t", `=${sessionId}`], {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: process.env.HOME ?? "/",
      env: { ...process.env, TERM: "xterm-256color", LANG: process.env.LANG ?? "C.UTF-8" },
    });
  } catch (err) {
    log.error({ sessionId, err }, "failed to spawn tmux attach");
    send({ type: "error", message: "Failed to attach to session" });
    ws.close(1011, "attach failed");
    return;
  }

  // Scrollback: lines above the visible screen. tmux redraws the visible part itself on attach,
  // so we only prepend the history and then let the attach redraw follow.
  tmux
    .captureHistory(sessionId, opts.historyLines)
    .then((history) => {
      const trimmed = history.replace(/^(\s*\n)+/, "");
      if (trimmed && ws.readyState === ws.OPEN) {
        ws.send(Buffer.from(trimmed.replace(/\n/g, "\r\n"), "utf8"));
      }
      // Force tmux to redraw the visible screen after the history has been written out.
      tmux.run(["refresh-client", "-t", `=${sessionId}`]).catch(() => undefined);
    })
    .catch((err) => log.warn({ sessionId, err }, "history capture failed"));

  send({ type: "ready", id: sessionId });

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, "utf8"));
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
