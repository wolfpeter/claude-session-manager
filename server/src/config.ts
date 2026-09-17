import os from "node:os";
import path from "node:path";
import { DEFAULT_STALL_SECONDS } from "./status.js";
import { slugify } from "./validate.js";

/** One named way to start Claude, e.g. "Alap" -> `claude`. Chosen in the new-session form. */
export interface ClaudeProfile {
  /** Slug of the label; what the browser sends back. */
  id: string;
  label: string;
  /** Shell command line run inside the fresh tmux session. */
  command: string;
}

export interface Config {
  port: number;
  host: string;
  /** Start profiles offered in the new-session form; the first one is the default. */
  claudeProfiles: ClaudeProfile[];
  sessionPrefix: string;
  allowedDirectories: string[];
  authToken: string;
  historyLines: number;
  logLevel: string;
  /** Optional tmux socket name (tmux -L). Empty = default server. */
  tmuxSocket: string;
  /** A busy-looking session with no output for this long is reported as stalled. */
  stallSeconds: number;
  /** The checkout this app runs from; the update button pulls and rebuilds it. */
  repoRoot: string;
  /** Branch the update follows. */
  updateBranch: string;
  /** How often to fetch the remote to see whether an update is waiting. 0 disables the check. */
  updateCheckMinutes: number;
  /**
   * Whether browser clients get the terminal's mouse reporting. Off by default: while it is on,
   * xterm hands drags to the application instead of selecting text, so copying needs Shift and is
   * impossible on a touch screen. Turn it on to click inside Claude's UI from the browser.
   */
  browserMouseReporting: boolean;
  /** Directory of the built frontend (index.html + assets). */
  webDist: string;
}

/**
 * CLAUDE_PROFILES is "Label=command|Label=command". Only the first "=" separates the two, so the
 * command may set an environment variable. Unset (or empty) means a single profile built from
 * CLAUDE_COMMAND, which is what older .env files have.
 */
function parseProfiles(env: NodeJS.ProcessEnv): ClaudeProfile[] {
  const raw = (env.CLAUDE_PROFILES ?? "").trim();
  if (!raw) return [{ id: "default", label: "Default", command: env.CLAUDE_COMMAND?.trim() || "claude" }];

  const used = new Set<string>();
  return raw
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const eq = entry.indexOf("=");
      const label = eq < 0 ? "" : entry.slice(0, eq).trim();
      const command = eq < 0 ? "" : entry.slice(eq + 1).trim();
      if (!label || !command) {
        throw new Error(`CLAUDE_PROFILES entry ${i + 1} must be "Label=command", got "${entry}"`);
      }
      let id = slugify(label);
      if (!id || used.has(id)) id = `profile-${i + 1}`;
      used.add(id);
      return { id, label, command };
    });
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
    claudeProfiles: parseProfiles(env),
    sessionPrefix,
    allowedDirectories: allowed,
    authToken: env.AUTH_TOKEN ?? "",
    historyLines: int(env.HISTORY_LINES, 200),
    logLevel: env.LOG_LEVEL ?? "info",
    tmuxSocket: env.TMUX_SOCKET ?? "",
    stallSeconds: int(env.STALL_SECONDS, DEFAULT_STALL_SECONDS),
    repoRoot: env.REPO_ROOT ?? path.resolve(import.meta.dirname, "../.."),
    updateBranch: env.UPDATE_BRANCH ?? "main",
    updateCheckMinutes: int(env.UPDATE_CHECK_MINUTES, 15),
    browserMouseReporting: (env.BROWSER_MOUSE_REPORTING ?? "off").toLowerCase() === "on",
    webDist: env.WEB_DIST ?? path.resolve(import.meta.dirname, "../../web/dist"),
  };
}
