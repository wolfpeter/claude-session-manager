import type { ClaudeSession, SessionStatus, UpdateStatus } from "./types";

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "Working",
  needs_input: "Needs you",
  waiting: "Waiting for you",
  stalled: "May be stuck",
  idle: "Shell only, Claude exited",
  stopped: "Stopped",
  error: "Error",
};

/** Most in need of a human first, quiet sessions last. */
const RANK: Record<SessionStatus, number> = {
  needs_input: 0,
  stalled: 1,
  waiting: 2,
  running: 3,
  idle: 4,
  stopped: 5,
  error: 6,
};

/** States where the session is on the user, so the one waiting longest belongs on top. */
const WAITING_ON_USER: SessionStatus[] = ["needs_input", "waiting", "stalled"];

export function sortSessions(sessions: ClaudeSession[]): ClaudeSession[] {
  return [...sessions].sort((a, b) => {
    const byRank = RANK[a.status] - RANK[b.status];
    if (byRank !== 0) return byRank;
    if (!WAITING_ON_USER.includes(a.status)) return 0;
    return (a.statusSince ?? "").localeCompare(b.statusSince ?? "");
  });
}

/** How many sessions are waiting on the user right now; drives the tab title badge. */
export function needsYouCount(sessions: ClaudeSession[]): number {
  return sessions.filter((s) => s.status === "needs_input" || s.status === "waiting").length;
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const rest = total % 60;
    return rest ? `${Math.floor(total / 60)}m ${rest}s` : `${Math.floor(total / 60)}m`;
  }
  const minutes = Math.floor((total % 3600) / 60);
  return minutes ? `${Math.floor(total / 3600)}h ${minutes}m` : `${Math.floor(total / 3600)}h`;
}

/**
 * The number worth showing next to the status: how long Claude has been working, or - when the
 * session is on the user - how long it has been waiting. The wait is measured from the status
 * change, not from the last output: Claude keeps redrawing its input box while it waits.
 */
export function statusAge(session: ClaudeSession, now: number = Date.now()): string {
  if (session.status === "running") {
    return session.busyForSeconds === undefined ? "" : formatElapsed(session.busyForSeconds);
  }
  if (!WAITING_ON_USER.includes(session.status) || !session.statusSince) return "";
  return formatElapsed((now - Date.parse(session.statusSince)) / 1000);
}

/** "started just now" / "started 2h 20m ago" - the age of the session itself. */
export function startedLabel(createdAt: string, now: number = Date.now()): string {
  const seconds = (now - Date.parse(createdAt)) / 1000;
  return seconds < 60 ? "started just now" : `started ${formatElapsed(seconds)} ago`;
}

/** Name for a switcher chip: short enough that several fit on a phone screen. */
export function chipLabel(name: string, max = 14): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1).replace(/[\s\-_]+$/, "")}…`;
}

/** Text of the update button: what pulling would bring in, or that there is nothing to bring. */
export function updateLabel(status: UpdateStatus): string {
  return status.available ? `Update · ${status.behind} new` : "Up to date";
}
