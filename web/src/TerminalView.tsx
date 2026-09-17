import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { api, wsUrl } from "./api";
import { copyText } from "./clipboard";
import { watchSelectionCopy } from "./selectionCopy";
import { useHostname } from "./useHostname";
import { chipLabel, needsYouCount, sortSessions, STATUS_LABEL } from "./sessionView";
import type { ClaudeSession } from "./types";

type ConnState = "connecting" | "open" | "reconnecting" | "ended";

interface Props {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
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

export function TerminalView({ id, onBack, onOpen, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [scrolledUp, setScrolledUp] = useState(false);
  // A selection is copied as soon as it settles (see selectionCopy.ts); these two only decide what
  // the button says and whether it is there at all - it is a retry, not the way to copy.
  const [hasSelection, setHasSelection] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Claude Code turns on the terminal's mouse reporting; while that is on, a plain drag goes to
  // Claude and only Shift+drag selects. Worth saying out loud instead of letting people guess.
  const [mouseMode, setMouseMode] = useState(false);
  const session = sessions.find((s) => s.id === id) ?? null;
  const hostname = useHostname(needsYouCount(sessions));

  // Every session's status, refreshed while visible: the header needs this one, the switcher
  // needs the others. One list call is no more work for the server than asking for this session.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .list()
        .then((list) => alive && setSessions(list))
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
    // URLs printed by tools (gcloud login, OAuth flows) open in a new tab on click/tap.
    term.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault();
      window.open(uri, "_blank", "noopener,noreferrer");
    }));
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

    // Touch scrolling done by hand: xterm's own gesture handling listens on the document and lets the
    // drag reach the page, which triggers pull-to-refresh on mobile Chrome. Handling it here (and
    // stopping propagation) keeps the gesture inside the terminal and scrolls its buffer.
    let touchY: number | null = null;
    let carry = 0;
    const rowHeight = () => host.clientHeight / Math.max(1, term.rows);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchY = e.touches[0].clientY;
        carry = 0;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      const y = e.touches[0].clientY;
      carry += touchY - y;
      touchY = y;
      const rows = Math.trunc(carry / rowHeight());
      if (rows !== 0) {
        term.scrollLines(rows);
        carry -= rows * rowHeight();
      }
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    const onScroll = term.onScroll(() => {
      const buf = term.buffer.active;
      setScrolledUp(buf.viewportY < buf.baseY);
    });

    // Let go of a drag and the text is already on the clipboard, like in a terminal emulator.
    const selectionCopy = watchSelectionCopy(term, {
      copy: copyText,
      // A new selection is not on the clipboard yet, so the button starts over with it.
      onSelection: (text) => {
        setHasSelection(text.length > 0);
        setCopyState("idle");
      },
      onCopied: (ok) => setCopyState(ok ? "copied" : "failed"),
    });
    const modeTimer = window.setInterval(() => setMouseMode(term.modes.mouseTrackingMode !== "none"), 1000);

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
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      onScroll.dispose();
      selectionCopy.dispose();
      window.clearInterval(modeTimer);
      onData.dispose();
      onBinary.dispose();
      ws?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [id]);

  /** Copies the selection again: the button is there for when the automatic copy was refused. */
  const copy = async () => {
    const term = termRef.current;
    if (!term?.hasSelection()) return;
    setCopyState((await copyText(term.getSelection())) ? "copied" : "failed");
    term.focus();
  };

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
          <span className="term-name">
            {hostname && <span className="term-host-name">{hostname} / </span>}
            {session?.name ?? id}
          </span>
          <span className={`conn conn-${conn}`}>{conn === "open" ? "" : conn}</span>
        </div>
        <button className="btn btn-quiet" onClick={() => void stop()} aria-label="Stop session">
          Stop
        </button>
      </header>
      {sessions.length > 1 && (
        <nav className="term-switch" aria-label="Switch session">
          {sortSessions(sessions).map((s) => {
            const current = s.id === id;
            return (
              <button
                key={s.id}
                type="button"
                className={`chip status-${s.status}${current ? " chip-current" : ""}`}
                title={`${s.name}: ${STATUS_LABEL[s.status]}`}
                aria-current={current || undefined}
                disabled={current}
                onClick={() => onOpen(s.id)}
              >
                <span className="dot" />
                {chipLabel(s.name)}
              </button>
            );
          })}
        </nav>
      )}
      <div className="term-host" ref={hostRef} />
      <div className="copy-bar">
        {hasSelection && (
          <button
            type="button"
            className={`copy-selection${copyState === "failed" ? " copy-failed" : ""}`}
            // Keep the selection and the terminal focus: the default mousedown would take both.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void copy()}
            aria-label="Copy the selected text"
          >
            {copyState === "copied" ? "✓ copied" : copyState === "failed" ? "copy failed - tap to retry" : "⧉ copy"}
          </button>
        )}
        {!IS_TOUCH && mouseMode && !hasSelection && <span className="copy-hint">Shift+drag to select</span>}
      </div>
      {scrolledUp && (
        <button
          type="button"
          className="jump-bottom"
          onClick={() => termRef.current?.scrollToBottom()}
          aria-label="Jump to the latest output"
        >
          ↓ latest
        </button>
      )}
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
