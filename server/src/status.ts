import type { SessionStatus } from "./types.js";

/** What we know about a session's active pane at one point in time. */
export interface PaneSnapshot {
  paneDead: boolean;
  /** Command running in the pane, e.g. "claude", "node", "zsh". */
  paneCommand: string;
  /** Visible pane contents (tmux capture-pane), plain text. */
  text: string;
  /**
   * How long ago the visible screen last changed. Measured by comparing captures, not from
   * tmux's session_activity: tmux only advances that while a client is attached, so every
   * session nobody is watching - the whole point of this dashboard - would look frozen.
   */
  secondsSinceChange: number;
}

export interface StatusResult {
  status: SessionStatus;
  /** Short human readable hint, e.g. "Brewing…" or "Permission request". */
  detail?: string;
  /** Seconds the current turn has been running, read from the spinner. */
  busyForSeconds?: number;
}

export interface ClassifyOptions {
  /** A busy-looking pane with no output for this long is reported as stalled. */
  stallSeconds?: number;
}

/** `claude` is a node script, so node (and bun) count as Claude running. */
const CLAUDE_COMMANDS = new Set(["claude", "node", "bun"]);

export const DEFAULT_STALL_SECONDS = 120;

/** Below this, a pane we cannot classify is assumed to be working: tmux saw output just now. */
const FRESH_OUTPUT_SECONDS = 10;

/**
 * Blocking prompts, most specific first. These only ever appear on the visible screen while
 * Claude waits for an answer, so they outrank a spinner line left above them.
 */
const BLOCKING_PROMPTS: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /Is this a project you created or one you trust|I trust this folder/, detail: "Folder trust prompt" },
  { pattern: /Do you want to proceed\?/, detail: "Permission request" },
  { pattern: /Enter to (?:select|confirm)\b|↑\/↓ to navigate/, detail: "Choose an option" },
];

/**
 * Claude's spinner line, e.g. "✽ Brewing… (2m 0s · ↓ 8.9k tokens)". The elapsed time keeps
 * counting while Claude works, including while a subagent or a long tool call runs, so its
 * presence - and the tmux activity it generates - is what separates "working" from "waiting".
 */
const SPINNER = /^\s*\S{0,2}\s*([^\n(]{1,40}?)…\s*\((?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s/u;

/** The input box at the bottom: "❯" alone, or with whatever the user has typed so far. */
const INPUT_PROMPT = /^\s*[❯>](?:\s|$)/u;

function findSpinner(lines: string[]): { detail: string; busyForSeconds: number } | undefined {
  for (const line of lines) {
    const m = SPINNER.exec(line);
    if (!m) continue;
    const [, verb, h, min, s] = m;
    return {
      detail: `${verb.trim()}…`,
      busyForSeconds: Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s),
    };
  }
  return undefined;
}

/**
 * Turns a pane snapshot into a session status. Pure and synchronous: every tmux call happens
 * in the caller, so the rules below can be tested against captured panes.
 */
export function classifyPane(snapshot: PaneSnapshot, options: ClassifyOptions = {}): StatusResult {
  const stallSeconds = options.stallSeconds ?? DEFAULT_STALL_SECONDS;
  if (snapshot.paneDead) return { status: "stopped" };

  const command = snapshot.paneCommand.split("/").pop() ?? "";
  if (!CLAUDE_COMMANDS.has(command)) return { status: "idle" };

  const lines = snapshot.text.split("\n");

  for (const { pattern, detail } of BLOCKING_PROMPTS) {
    if (pattern.test(snapshot.text)) return { status: "needs_input", detail };
  }

  const spinner = findSpinner(lines);
  const busy = spinner ?? (/esc to interrupt/.test(snapshot.text) ? { detail: "Working", busyForSeconds: undefined } : undefined);
  if (busy) {
    const status = snapshot.secondsSinceChange > stallSeconds ? "stalled" : "running";
    return { status, detail: busy.detail, busyForSeconds: busy.busyForSeconds };
  }

  if (lines.some((line) => INPUT_PROMPT.test(line))) return { status: "waiting" };

  return { status: snapshot.secondsSinceChange <= FRESH_OUTPUT_SECONDS ? "running" : "waiting" };
}

/**
 * Per-session memory between polls: when the screen last changed, and when the session entered
 * its current status.
 *
 * Both clocks have to live here because tmux cannot answer either question. `session_activity`
 * only advances while a client is attached (an unwatched session looks frozen, which is exactly
 * backwards for this dashboard), and Claude redraws its input box while it waits, so "last
 * output" would say nothing about the length of a wait. State is in memory only: after a backend
 * restart every session starts counting from that moment.
 */
export class SessionWatch {
  private readonly panes = new Map<string, { hash: string; changedAt: number }>();
  private readonly statuses = new Map<string, { status: SessionStatus; since: number }>();

  /** Records the captured screen and reports how long it has been unchanged. */
  observePane(id: string, text: string, now: number = Date.now()): { changedAt: number; secondsSinceChange: number } {
    const hash = fingerprint(text);
    const previous = this.panes.get(id);
    const changedAt = previous && previous.hash === hash ? previous.changedAt : now;
    this.panes.set(id, { hash, changedAt });
    return { changedAt, secondsSinceChange: Math.max(0, Math.round((now - changedAt) / 1000)) };
  }

  /** Epoch ms when the session entered `status`. */
  markStatus(id: string, status: SessionStatus, now: number = Date.now()): number {
    const previous = this.statuses.get(id);
    if (previous?.status === status) return previous.since;
    this.statuses.set(id, { status, since: now });
    return now;
  }

  /** Drops sessions that no longer exist, so the maps cannot grow forever. */
  retain(ids: Iterable<string>): void {
    const alive = new Set(ids);
    for (const map of [this.panes, this.statuses]) {
      for (const id of map.keys()) {
        if (!alive.has(id)) map.delete(id);
      }
    }
  }
}

/** Cheap content fingerprint; only equality matters, so a non-cryptographic hash is enough. */
function fingerprint(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}
