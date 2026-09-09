import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TmuxSessionInfo {
  name: string;
  /** Unix epoch seconds */
  created: number;
  /** Directory the session was started in (session_path) */
  path: string;
  /** Current path of the active pane */
  panePath: string;
  /** Command running in the active pane (e.g. "zsh", "claude", "node") */
  paneCommand: string;
  paneDead: boolean;
  attached: number;
}

export class TmuxError extends Error {
  constructor(message: string, readonly args: string[]) {
    super(message);
    this.name = "TmuxError";
  }
}

/** ASCII unit separator: never appears in tmux fields, unlike "|" or ":" which can be in paths. */
export const SEP = "";
const LIST_FORMAT = [
  "#{session_name}",
  "#{session_created}",
  "#{session_path}",
  "#{pane_current_path}",
  "#{pane_current_command}",
  "#{pane_dead}",
  "#{session_attached}",
].join(SEP);

export function parseListSessions(output: string): TmuxSessionInfo[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, created, path, panePath, paneCommand, paneDead, attached] = line.split(SEP);
      return {
        name,
        created: Number(created) || 0,
        path,
        panePath,
        paneCommand,
        paneDead: paneDead === "1",
        attached: Number(attached) || 0,
      };
    });
}

/**
 * Thin wrapper around the tmux CLI. Every call goes through execFile with an argument
 * array, so user-provided values are never interpreted by a shell.
 *
 * Target syntax: session-target commands (has-session, kill-session) take "=name" (exact match);
 * pane-target commands (send-keys, set-option, capture-pane) need "=name:" (exact session, current window).
 */
export class Tmux {
  constructor(
    private readonly binary = "tmux",
    private readonly socketName = "",
  ) {}

  /** Arguments that select the tmux server; needed for spawning `tmux attach` in a PTY too. */
  baseArgs(): string[] {
    return this.socketName ? ["-L", this.socketName] : [];
  }

  get command(): string {
    return this.binary;
  }

  async run(args: string[]): Promise<string> {
    const full = [...this.baseArgs(), ...args];
    try {
      const { stdout } = await execFileAsync(this.binary, full, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      const msg = (e.stderr ?? e.message ?? "").trim();
      throw new TmuxError(msg || "tmux failed", full);
    }
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      return parseListSessions(await this.run(["list-sessions", "-F", LIST_FORMAT]));
    } catch (err) {
      // No server running yet => no sessions. Everything else is a real error.
      if (err instanceof TmuxError && /no server running|No such file or directory|no sessions/i.test(err.message)) {
        return [];
      }
      throw err;
    }
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await this.run(["has-session", "-t", `=${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async newSession(name: string, cwd: string, opts: { cols?: number; rows?: number } = {}): Promise<void> {
    await this.run([
      "new-session", "-d", "-s", name, "-c", cwd,
      "-x", String(opts.cols ?? 200), "-y", String(opts.rows ?? 50),
    ]);
  }

  /** Types `text` literally into the session and presses Enter. */
  async sendCommand(name: string, text: string): Promise<void> {
    await this.run(["send-keys", "-t", `=${name}:`, "-l", text]);
    await this.run(["send-keys", "-t", `=${name}:`, "Enter"]);
  }

  async killSession(name: string): Promise<void> {
    await this.run(["kill-session", "-t", `=${name}`]);
  }

  async setSessionOption(name: string, option: string, value: string): Promise<void> {
    await this.run(["set-option", "-t", `=${name}:`, option, value]);
  }

  /** Returns undefined when the option is not set. */
  async getSessionOption(name: string, option: string): Promise<string | undefined> {
    try {
      const out = await this.run(["show-options", "-t", `=${name}:`, "-qv", option]);
      const v = out.replace(/\n$/, "");
      return v === "" ? undefined : v;
    } catch {
      return undefined;
    }
  }

  async setGlobalOption(option: string, value: string): Promise<void> {
    await this.run(["set-option", "-g", option, value]);
  }

  private serverOptionsApplied = false;

  /** TERM used for browser clients. Its terminal-overrides entry disables the alternate screen. */
  static readonly BROWSER_TERM = "tmux-256color";
  private static readonly OVERRIDE = `${Tmux.BROWSER_TERM}:smcup@:rmcup@`;

  /**
   * Server-wide options needed by the browser clients. Safe to call often: no-op when already
   * applied, silently skipped when no server is running yet.
   *
   * - window-size latest: tmux sizes a window to the smallest attached client by default; "latest"
   *   follows the most recently active client, so a phone opening a session does not shrink the
   *   desktop view.
   * - terminal-overrides for BROWSER_TERM: without smcup/rmcup, tmux draws on the browser terminal's
   *   normal screen, so lines scrolling off the top land in xterm.js scrollback and the user can
   *   scroll back on the phone. Keyed by TERM, so desktop tmux clients (xterm-256color) are untouched.
   */
  async ensureServerOptions(): Promise<void> {
    if (this.serverOptionsApplied) return;
    try {
      await this.setGlobalOption("window-size", "latest");
      const current = await this.run(["show-options", "-gv", "terminal-overrides"]).catch(() => "");
      if (!current.includes(Tmux.OVERRIDE)) {
        await this.run(["set-option", "-ga", "terminal-overrides", `,${Tmux.OVERRIDE}`]);
      }
      this.serverOptionsApplied = true;
    } catch {
      /* no tmux server yet: retried on the next call */
    }
  }

  /** Scrollback (history above the visible screen) with colours, last `lines` lines. */
  async captureHistory(name: string, lines: number): Promise<string> {
    if (lines <= 0) return "";
    return this.run(["capture-pane", "-p", "-e", "-J", "-t", `=${name}:`, "-S", `-${lines}`, "-E", "-1"]);
  }
}
