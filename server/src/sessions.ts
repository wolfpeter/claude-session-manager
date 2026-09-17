import type { Config } from "./config.js";
import { classifyPane, SessionWatch } from "./status.js";
import type { Tmux, TmuxSessionInfo } from "./tmux.js";
import type { ClaudeSession } from "./types.js";
import {
  assertSessionId,
  slugify,
  validateName,
  validateProfile,
  validateWorkingDirectory,
  ValidationError,
} from "./validate.js";

const OPT_NAME = "@csm_name";

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = "Session not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export class SessionService {
  /** Screen-change and status clocks kept between polls; see SessionWatch. */
  private readonly watch = new SessionWatch();

  constructor(
    private readonly tmux: Tmux,
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  /**
   * Reads the session's visible pane and turns it into a status. One capture-pane call per
   * session on top of the single list-sessions call; the list endpoint is polled every few
   * seconds for a handful of sessions, so this stays cheap.
   */
  private async toSession(info: TmuxSessionInfo): Promise<ClaudeSession> {
    const text = await this.tmux.capturePane(info.name).catch(() => "");
    const now = Date.now();
    const seen = this.watch.observePane(info.name, text, now);
    const { status, detail, busyForSeconds } = classifyPane(
      { paneDead: info.paneDead, paneCommand: info.paneCommand, text, secondsSinceChange: seen.secondsSinceChange },
      { stallSeconds: this.config.stallSeconds },
    );
    return {
      id: info.name,
      name: info.displayName || info.name.slice(this.config.sessionPrefix.length),
      workingDirectory: info.panePath || info.path,
      status,
      statusDetail: detail,
      statusSince: new Date(this.watch.markStatus(info.name, status, now)).toISOString(),
      busyForSeconds,
      createdAt: info.created ? new Date(info.created * 1000).toISOString() : undefined,
      lastActivityAt: new Date(seen.changedAt).toISOString(),
      attached: info.attached,
    };
  }

  /** Discovers every tmux session with the configured prefix (including manually created ones). */
  async list(): Promise<ClaudeSession[]> {
    const infos = (await this.tmux.listSessions()).filter((s) => s.name.startsWith(this.config.sessionPrefix));
    this.watch.retain(infos.map((info) => info.name));
    const sessions = await Promise.all(infos.map((info) => this.toSession(info)));
    return sessions.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<ClaudeSession> {
    assertSessionId(id, this.config.sessionPrefix);
    const found = (await this.list()).find((s) => s.id === id);
    if (!found) throw new NotFoundError();
    return found;
  }

  async exists(id: string): Promise<boolean> {
    if (!id.startsWith(this.config.sessionPrefix)) return false;
    return this.tmux.hasSession(id);
  }

  private async uniqueId(base: string): Promise<string> {
    const existing = new Set((await this.tmux.listSessions()).map((s) => s.name));
    let id = base;
    for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  async create(input: { name?: unknown; workingDirectory?: unknown; profile?: unknown }): Promise<ClaudeSession> {
    const name = validateName(input.name);
    const cwd = await validateWorkingDirectory(input.workingDirectory, this.config.allowedDirectories);
    const profile = validateProfile(input.profile, this.config.claudeProfiles);
    const slug = slugify(name);
    if (!slug) throw new ValidationError("name must contain at least one letter or digit");
    const id = await this.uniqueId(`${this.config.sessionPrefix}${slug}`);

    await this.tmux.newSession(id, cwd);
    try {
      await this.tmux.setSessionOption(id, OPT_NAME, name);
      // The tmux status bar costs a row on a phone; Claude Code has its own status line anyway.
      await this.tmux.setSessionOption(id, "status", "off");
      await this.tmux.ensureServerOptions();
      await this.tmux.sendCommand(id, profile.command);
    } catch (err) {
      await this.tmux.killSession(id).catch(() => undefined);
      throw err;
    }
    this.log.info({ id, name, cwd, profile: profile.id }, "session created");
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    assertSessionId(id, this.config.sessionPrefix);
    if (!(await this.tmux.hasSession(id))) throw new NotFoundError();
    await this.tmux.killSession(id);
    this.log.info({ id }, "session stopped");
  }
}
