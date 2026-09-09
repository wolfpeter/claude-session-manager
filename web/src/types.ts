// Mirror of server/src/types.ts (kept in sync by hand; tiny surface).
export type SessionStatus = "running" | "waiting" | "idle" | "stopped" | "error";

export interface ClaudeSession {
  id: string;
  name: string;
  workingDirectory: string;
  status: SessionStatus;
  createdAt?: string;
  attached: number;
}

export interface AppConfig {
  hostname: string;
  allowedDirectories: string[];
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
