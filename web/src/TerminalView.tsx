import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api, wsUrl } from "./api";
import type { ClaudeSession } from "./types";

type ConnState = "connecting" | "open" | "reconnecting" | "ended";

interface Props {
  id: string;
  onBack: () => void;
  onError: (err: unknown) => void;
}

const IS_TOUCH = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Soft keys the phone keyboard lacks but Claude Code needs. */
const KEYS: { label: string; seq: string; title: string }[] = [
  { label: "Esc", seq: "\x1b", title: "Escape: interrupt Claude" },
  { label: "Tab", seq: "\t", title: "Tab" },
  { label: "⇧Tab", seq: "\x1b[Z", title: "Shift+Tab: cycle permission mode" },
  { label: "↑", seq: "\x1b[A", title: "Up" },
  { label: "↓", seq: "\x1b[B", title: "Down" },
  { label: "←", seq: "\x1b[D", title: "Left" },
  { label: "→", seq: "\x1b[C", title: "Right" },
  { label: "^C", seq: "\x03", title: "Ctrl+C" },
];

export function TerminalView({ id, onBack, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [session, setSession] = useState<ClaudeSession | null>(null);

  // Session metadata (name + status) for the header, refreshed while visible.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get(id)
        .then((s) => alive && setSession(s))
        .catch((err) => {
          onError(err);
        });
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: IS_TOUCH ? 13 : 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", ui-monospace, Menlo, monospace',
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#11141a",
        foreground: "#e4e2dc",
        cursor: "#8fd6bd",
        selectionBackground: "rgba(143, 214, 189, 0.3)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    let ws: WebSocket | null = null;
    let closedByUs = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const connect = () => {
      if (closedByUs) return;
      setConn(attempt === 0 ? "connecting" : "reconnecting");
      fit.fit();
      const socket = new WebSocket(wsUrl(id, term.cols, term.rows));
      socket.binaryType = "arraybuffer";
      ws = socket;

      socket.onopen = () => {
        attempt = 0;
        setConn("open");
        // tmux will redraw the screen; start from a clean slate so scrollback is not duplicated.
        term.reset();
        sendResize();
      };
      socket.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
          return;
        }
        try {
          const msg = JSON.parse(String(ev.data)) as { type: string; message?: string; code?: number | null };
          if (msg.type === "error") {
            term.writeln(`\r\n\x1b[31m${msg.message ?? "error"}\x1b[0m`);
          } else if (msg.type === "exit") {
            term.writeln("\r\n\x1b[2mtmux client exited\x1b[0m");
          }
        } catch {
          /* ignore malformed control frames */
        }
      };
      socket.onclose = (ev) => {
        ws = null;
        if (closedByUs) return;
        if (ev.code === 4004) {
          setConn("ended");
          term.writeln("\r\n\x1b[33mThis session no longer exists.\x1b[0m");
          return;
        }
        setConn("reconnecting");
        attempt += 1;
        const delay = Math.min(10000, 500 * 2 ** Math.min(attempt, 5));
        retryTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => {
        /* onclose follows */
      };
    };

    const onData = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const onBinary = term.onBinary((data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    ro.observe(host);

    // Coming back to the tab after minutes: reconnect immediately instead of waiting for the backoff.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !ws && !closedByUs) {
        window.clearTimeout(retryTimer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    connect();
    term.focus();

    return () => {
      closedByUs = true;
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      ro.disconnect();
      onData.dispose();
      onBinary.dispose();
      ws?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [id]);

  // term.input() feeds the sequence through onData, so it travels the same path as typed keys.
  const sendKey = (seq: string) => {
    termRef.current?.input(seq, true);
    termRef.current?.focus();
  };

  const stop = async () => {
    if (!window.confirm(`Stop "${session?.name ?? id}"? Claude and its tmux session end. Project files stay untouched.`)) return;
    try {
      await api.remove(id);
      onBack();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="term-page">
      <header className="term-header">
        <button className="btn btn-quiet" onClick={onBack} aria-label="Back to sessions">
          ‹ Sessions
        </button>
        <div className="term-title">
          <span className={`dot status-${session?.status ?? "idle"}`} />
          <span className="term-name">{session?.name ?? id}</span>
          <span className={`conn conn-${conn}`}>{conn === "open" ? "" : conn}</span>
        </div>
        <button className="btn btn-quiet" onClick={() => void stop()} aria-label="Stop session">
          Stop
        </button>
      </header>
      <div className="term-host" ref={hostRef} />
      {IS_TOUCH && (
        <div className="keybar" role="toolbar" aria-label="Extra keys">
          {KEYS.map((k) => (
            <button key={k.label} type="button" title={k.title} onClick={() => sendKey(k.seq)}>
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
