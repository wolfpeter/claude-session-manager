import type { Config } from "./config.js";
import type { Tmux, TmuxSessionInfo } from "./tmux.js";
import type { ClaudeSession, SessionStatus } from "./types.js";
import { assertSessionId, slugify, validateName, validateWorkingDirectory, ValidationError } from "./validate.js";

const OPT_NAME = "@csm_name";

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = "Session not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Commands that mean "Claude Code is running in the pane". `claude` is a node script, so node counts too. */
const CLAUDE_COMMANDS = new Set(["claude", "node", "bun"]);

export function deriveStatus(info: TmuxSessionInfo): SessionStatus {
  if (info.paneDead) return "stopped";
  const cmd = info.paneCommand.split("/").pop() ?? "";
  return CLAUDE_COMMANDS.has(cmd) ? "running" : "idle";
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export class SessionService {
  constructor(
    private readonly tmux: Tmux,
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  private toSession(info: TmuxSessionInfo, name?: string): ClaudeSession {
    return {
      id: info.name,
      name: name ?? info.name.slice(this.config.sessionPrefix.length),
      workingDirectory: info.panePath || info.path,
      status: deriveStatus(info),
      createdAt: info.created ? new Date(info.created * 1000).toISOString() : undefined,
      attached: info.attached,
    };
  }

  /** Discovers every tmux session with the configured prefix (including manually created ones). */
  async list(): Promise<ClaudeSession[]> {
    const infos = (await this.tmux.listSessions()).filter((s) => s.name.startsWith(this.config.sessionPrefix));
    const sessions = await Promise.all(
      infos.map(async (info) => this.toSession(info, await this.tmux.getSessionOption(info.name, OPT_NAME))),
    );
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

  async create(input: { name?: unknown; workingDirectory?: unknown }): Promise<ClaudeSession> {
    const name = validateName(input.name);
    const cwd = await validateWorkingDirectory(input.workingDirectory, this.config.allowedDirectories);
    const slug = slugify(name);
    if (!slug) throw new ValidationError("name must contain at least one letter or digit");
    const id = await this.uniqueId(`${this.config.sessionPrefix}${slug}`);

    await this.tmux.newSession(id, cwd);
    try {
      await this.tmux.setSessionOption(id, OPT_NAME, name);
      // The tmux status bar costs a row on a phone; Claude Code has its own status line anyway.
      await this.tmux.setSessionOption(id, "status", "off");
      await this.tmux.ensureServerOptions();
      await this.tmux.sendCommand(id, this.config.claudeCommand);
    } catch (err) {
      await this.tmux.killSession(id).catch(() => undefined);
      throw err;
    }
    this.log.info({ id, name, cwd }, "session created");
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    assertSessionId(id, this.config.sessionPrefix);
    if (!(await this.tmux.hasSession(id))) throw new NotFoundError();
    await this.tmux.killSession(id);
    this.log.info({ id }, "session stopped");
  }
}
