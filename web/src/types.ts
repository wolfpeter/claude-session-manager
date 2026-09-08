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
  allowedDirectories: string[];
  sessionPrefix: string;
}
