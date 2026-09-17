/**
 * Session status as exposed to the frontend, derived from the pane contents (see status.ts).
 * - running: Claude is working (its spinner is redrawing); a subagent or a long tool call counts too
 * - needs_input: a blocking prompt is on screen (question, permission request, folder trust)
 * - waiting: the turn ended, the input box is empty and Claude waits for the user
 * - stalled: looks busy but tmux saw no output for a while
 * - idle: the pane is back to a plain shell, Claude exited
 */
export type SessionStatus = "running" | "needs_input" | "waiting" | "stalled" | "idle" | "stopped" | "error";

export interface ClaudeSession {
  /** tmux session name, e.g. "claude-api". Used in URLs. */
  id: string;
  /** Human readable name, e.g. "API refactor". Falls back to id without prefix. */
  name: string;
  workingDirectory: string;
  status: SessionStatus;
  createdAt?: string;
  /** Short hint about the status, e.g. "Brewing…" or "Permission request". */
  statusDetail?: string;
  /** Seconds the current turn has been running, read from Claude's spinner. */
  busyForSeconds?: number;
  /** When the session entered this status (ISO). Reset when the backend restarts. */
  statusSince?: string;
  /** When the session's visible screen last changed (ISO). */
  lastActivityAt?: string;
  /** Number of tmux clients currently attached (browser tabs + local terminals). */
  attached: number;
}

export interface CreateSessionRequest {
  name: string;
  workingDirectory: string;
  /** Id of a configured start profile. Omitted means the first (default) one. */
  profile?: string;
}

/** Browser -> server WebSocket messages (JSON text frames). Terminal output is sent as binary frames. */
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

/** Server -> browser control messages (JSON text frames). */
export type ServerMessage =
  | { type: "ready"; id: string }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };
