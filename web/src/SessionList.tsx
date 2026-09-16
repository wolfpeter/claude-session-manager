import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { NewSessionForm } from "./NewSessionForm";
import { useHostname } from "./useHostname";
import { needsYouCount, sortSessions, startedLabel, statusAge, STATUS_LABEL } from "./sessionView";
import type { ClaudeSession, ExternalClaude } from "./types";

function shortenPath(p: string): string {
  return p.replace(/^\/home\/[^/]+/, "~");
}

function duration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
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
  const [external, setExternal] = useState<ExternalClaude[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const hostname = useHostname(sessions ? needsYouCount(sessions) : 0);

  const refresh = useCallback(async () => {
    try {
      const [list, ext] = await Promise.all([api.list(), api.external().catch(() => [])]);
      setSessions(list);
      setExternal(ext);
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
        <div>
          <h1>Claude sessions</h1>
          {hostname && <span className="hostname">{hostname}</span>}
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          New session
        </button>
      </header>

      {error && <p className="notice notice-error">{error}</p>}

      {sessions === null && !error && <p className="muted">Loading…</p>}

      {sessions && sessions.length === 0 && (
        <div className="empty">
          <p>No Claude sessions are running in tmux.</p>
          <p className="muted">Start one here, or run <code>tmux new -s claude-something</code> on the machine and it appears in this list.</p>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="sessions">
          {sortSessions(sessions).map((s) => (
            <li key={s.id} className={`session status-${s.status}`}>
              <button className="session-main" onClick={() => onOpen(s.id)} aria-label={`Open ${s.name}`}>
                <span className="dot" title={STATUS_LABEL[s.status]} />
                <span className="session-text">
                  <span className="session-name">{s.name}</span>
                  <span className="session-path">{shortenPath(s.workingDirectory)}</span>
                  <span className="session-meta">
                    <span className="session-status">
                      {STATUS_LABEL[s.status]}
                      {statusAge(s) && ` · ${statusAge(s)}`}
                    </span>
                    {s.statusDetail && <span>{s.statusDetail}</span>}
                    {s.createdAt && <span>{startedLabel(s.createdAt)}</span>}
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

      {external.length > 0 && (
        <section className="external">
          <h2>Running outside tmux</h2>
          <p className="muted">
            These Claude Code processes were started in ordinary terminals, so no browser terminal can attach to them.
            To continue one from here, exit it there, then start a session in the same directory and run <code>/resume</code>.
          </p>
          <ul className="sessions">
            {external.map((e) => (
              <li key={e.pid} className="session session-external">
                <div className="session-main">
                  <span className="dot status-running" />
                  <span className="session-text">
                    <span className="session-name">{shortenPath(e.workingDirectory).split("/").pop() || e.workingDirectory}</span>
                    <span className="session-path">{shortenPath(e.workingDirectory)}</span>
                    <span className="session-meta">
                      <span>running {duration(e.uptimeSeconds)}</span>
                      <span>{e.tty}</span>
                      <span>pid {e.pid}</span>
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
