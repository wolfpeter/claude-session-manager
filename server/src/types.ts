/** Session status as exposed to the frontend. "waiting"/"error" are reserved for later. */
export type SessionStatus = "running" | "waiting" | "idle" | "stopped" | "error";

export interface ClaudeSession {
  /** tmux session name, e.g. "claude-api". Used in URLs. */
  id: string;
  /** Human readable name, e.g. "API refactor". Falls back to id without prefix. */
  name: string;
  workingDirectory: string;
  status: SessionStatus;
  createdAt?: string;
  /** Number of tmux clients currently attached (browser tabs + local terminals). */
  attached: number;
}

export interface CreateSessionRequest {
  name: string;
  workingDirectory: string;
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
