import os from "node:os";
import path from "node:path";
import { DEFAULT_STALL_SECONDS } from "./status.js";

export interface Config {
  port: number;
  host: string;
  claudeCommand: string;
  sessionPrefix: string;
  allowedDirectories: string[];
  authToken: string;
  historyLines: number;
  logLevel: string;
  /** Optional tmux socket name (tmux -L). Empty = default server. */
  tmuxSocket: string;
  /** A busy-looking session with no output for this long is reported as stalled. */
  stallSeconds: number;
  /** Directory of the built frontend (index.html + assets). */
  webDist: string;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = os.homedir();
  // No default project folder is assumed: without ALLOWED_DIRECTORIES, sessions may start
  // anywhere under the user's home. install.sh writes a narrower value into .env.
  const allowed = (env.ALLOWED_DIRECTORIES ?? home)
    .split(":")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(d));

  const sessionPrefix = env.SESSION_PREFIX ?? "claude-";
  if (!/^[A-Za-z0-9_-]+$/.test(sessionPrefix)) {
    throw new Error(`SESSION_PREFIX must match [A-Za-z0-9_-]+, got "${sessionPrefix}"`);
  }

  return {
    port: int(env.PORT, 31415),
    host: env.HOST ?? "0.0.0.0",
    claudeCommand: env.CLAUDE_COMMAND ?? "claude",
    sessionPrefix,
    allowedDirectories: allowed,
    authToken: env.AUTH_TOKEN ?? "",
    historyLines: int(env.HISTORY_LINES, 200),
    logLevel: env.LOG_LEVEL ?? "info",
    tmuxSocket: env.TMUX_SOCKET ?? "",
    stallSeconds: int(env.STALL_SECONDS, DEFAULT_STALL_SECONDS),
    webDist: env.WEB_DIST ?? path.resolve(import.meta.dirname, "../../web/dist"),
  };
}
