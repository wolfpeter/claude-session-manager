import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { NewSessionForm } from "./NewSessionForm";
import type { ClaudeSession } from "./types";

const STATUS_LABEL: Record<ClaudeSession["status"], string> = {
  running: "Claude running",
  waiting: "Waiting for input",
  idle: "Shell only, Claude exited",
  stopped: "Stopped",
  error: "Error",
};

function shortenPath(p: string): string {
  return p.replace(/^\/home\/[^/]+/, "~");
}

function age(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

interface Props {
  onOpen: (id: string) => void;
  onError: (err: unknown) => void;
}

export function SessionList({ onOpen, onError }: Props) {
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSessions(await api.list());
      setError(null);
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : "Could not load sessions");
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const stop = async (s: ClaudeSession) => {
    if (!window.confirm(`Stop "${s.name}"? Claude and its tmux session end. Project files stay untouched.`)) return;
    try {
      await api.remove(s.id);
      await refresh();
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : "Could not stop session");
    }
  };

  return (
    <main className="list-page">
      <header className="list-header">
        <h1>Claude sessions</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          New session
        </button>
      </header>

      {error && <p className="notice notice-error">{error}</p>}

      {sessions === null && !error && <p className="muted">Loading…</p>}

      {sessions && sessions.length === 0 && (
        <div className="empty">
          <p>No Claude sessions are running.</p>
          <p className="muted">Start one here, or run <code>tmux new -s claude-something</code> on the machine and it appears in this list.</p>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id} className={`session status-${s.status}`}>
              <button className="session-main" onClick={() => onOpen(s.id)} aria-label={`Open ${s.name}`}>
                <span className="dot" title={STATUS_LABEL[s.status]} />
                <span className="session-text">
                  <span className="session-name">{s.name}</span>
                  <span className="session-path">{shortenPath(s.workingDirectory)}</span>
                  <span className="session-meta">
                    <span>{STATUS_LABEL[s.status]}</span>
                    {s.createdAt && <span>started {age(s.createdAt)} ago</span>}
                    {s.attached > 0 && <span>{s.attached} viewer{s.attached > 1 ? "s" : ""}</span>}
                  </span>
                </span>
              </button>
              <button className="btn btn-quiet session-stop" onClick={() => void stop(s)} aria-label={`Stop ${s.name}`}>
                Stop
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewSessionForm
          onCancel={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            onOpen(s.id);
          }}
          onError={onError}
        />
      )}
    </main>
  );
}
