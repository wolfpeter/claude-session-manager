import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "./sessions.js";
import type { Tmux } from "./tmux.js";

const execFileAsync = promisify(execFile);

export interface UpdateStatus {
  /** False when this is not a git checkout with a remote: the UI then offers nothing. */
  supported: boolean;
  available: boolean;
  /** Commits the remote branch is ahead by, as of the last check. */
  behind: number;
  /** Short commit id of what is running now. */
  current: string;
  branch: string;
  /** Modified tracked files: `git pull --ff-only` in deploy.sh can refuse to overwrite them. */
  dirty: boolean;
  /** When the remote was last fetched (ISO); undefined until the first check. */
  checkedAt?: string;
}

const UNSUPPORTED: UpdateStatus = {
  supported: false, available: false, behind: 0, current: "", branch: "", dirty: false,
};

/**
 * "Is there a new version, and run the update" for the checkout this app runs from.
 *
 * The update itself is not run by this process: it ends with restarting this very service, and a
 * process cannot outlive its own restart. Instead it starts `deploy.sh` in a tmux session, which
 * the browser attaches to like any other session - the output stays visible across the restart
 * (KillMode=process keeps tmux alive). deploy.sh restarts the service by ending this process, so
 * nothing on the way needs sudo, which NoNewPrivileges=yes would refuse anyway.
 */
export class Updater {
  private lastCheck?: string;

  constructor(
    private readonly repoRoot: string,
    private readonly branch: string,
    private readonly log: Logger,
  ) {}

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.repoRoot, ...args], { encoding: "utf8" });
    return stdout.trim();
  }

  /** Fetches the remote branch so `status()` can see new commits. Network call; failures are logged. */
  async check(): Promise<void> {
    try {
      await this.git("fetch", "--quiet", "origin", this.branch);
      this.lastCheck = new Date().toISOString();
    } catch (err) {
      this.log.warn({ err }, "update check failed");
    }
  }

  async status(): Promise<UpdateStatus> {
    try {
      const current = await this.git("rev-parse", "--short", "HEAD");
      // Untracked files do not block a fast-forward, so they must not look like a problem;
      // modified tracked files do.
      const dirty = (await this.git("status", "--porcelain", "--untracked-files=no")) !== "";
      // No remote-tracking ref yet (never fetched, or no remote at all) means nothing to compare to.
      const behind = Number(
        await this.git("rev-list", "--count", `HEAD..origin/${this.branch}`).catch(() => "0"),
      );
      return {
        supported: true,
        available: behind > 0,
        behind,
        current,
        branch: this.branch,
        dirty,
        checkedAt: this.lastCheck,
      };
    } catch {
      return UNSUPPORTED;
    }
  }

  /**
   * Starts (or re-attaches to) the tmux session that runs deploy.sh. Returns the session id for
   * the browser to open.
   */
  async start(tmux: Tmux, sessionId: string): Promise<string> {
    if (await tmux.hasSession(sessionId)) return sessionId;
    await tmux.newSession(sessionId, this.repoRoot);
    try {
      await tmux.setSessionOption(sessionId, "@csm_name", "Update");
      await tmux.setSessionOption(sessionId, "status", "off");
      await tmux.ensureServerOptions();
      await tmux.sendCommand(sessionId, "./deploy.sh");
    } catch (err) {
      await tmux.killSession(sessionId).catch(() => undefined);
      throw err;
    }
    this.log.info({ sessionId, repoRoot: this.repoRoot }, "update session started");
    return sessionId;
  }
}
