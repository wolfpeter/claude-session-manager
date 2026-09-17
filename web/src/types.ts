// Mirror of server/src/types.ts (kept in sync by hand; tiny surface).
export type SessionStatus = "running" | "needs_input" | "waiting" | "stalled" | "idle" | "stopped" | "error";

export interface ClaudeSession {
  id: string;
  name: string;
  workingDirectory: string;
  status: SessionStatus;
  /** Short hint about the status, e.g. "Brewing…" or "Permission request". */
  statusDetail?: string;
  /** Seconds the current turn has been running, read from Claude's spinner. */
  busyForSeconds?: number;
  /** When the session entered this status (ISO). Reset when the backend restarts. */
  statusSince?: string;
  createdAt?: string;
  /** When the session's visible screen last changed (ISO). */
  lastActivityAt?: string;
  attached: number;
}

/** One configured way to start Claude (CLAUDE_PROFILES on the server). */
export interface StartProfile {
  id: string;
  label: string;
}

export interface AppConfig {
  hostname: string;
  allowedDirectories: string[];
  /** Direct subfolders of the allowed roots: exactly what the new-session form offers. */
  projectDirectories: string[];
  profiles: StartProfile[];
  sessionPrefix: string;
}

/** Claude Code process outside tmux: visible, but no terminal can be attached to it. */
export interface ExternalClaude {
  pid: number;
  tty: string;
  workingDirectory: string;
  uptimeSeconds: number;
  args: string;
}

/** State of the checkout this dashboard runs from; drives the update button. */
export interface UpdateStatus {
  supported: boolean;
  available: boolean;
  behind: number;
  current: string;
  branch: string;
  dirty: boolean;
  checkedAt?: string;
}
