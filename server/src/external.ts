import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Tmux } from "./tmux.js";

const execFileAsync = promisify(execFile);

/** A Claude Code process that runs in a plain terminal, not inside a managed tmux session. */
export interface ExternalClaude {
  pid: number;
  tty: string;
  workingDirectory: string;
  /** Seconds since the process started */
  uptimeSeconds: number;
  args: string;
}

interface PsRow {
  pid: number;
  tty: string;
  etimes: number;
  args: string;
}

/** Parses `ps -eo pid=,tty=,etimes=,args=` output. */
export function parsePs(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), tty: m[2], etimes: Number(m[3]), args: m[4] });
  }
  return rows;
}

/** True when the command line is the Claude Code CLI (argv[0] basename is "claude"). */
export function isClaudeCommand(args: string): boolean {
  const argv0 = args.trim().split(/\s+/)[0] ?? "";
  const base = path.basename(argv0);
  if (base === "claude") return true;
  // `node /path/to/claude ...` when started through node explicitly
  if (/^node(js)?$/.test(base)) {
    const second = args.trim().split(/\s+/)[1] ?? "";
    return path.basename(second) === "claude";
  }
  return false;
}

/**
 * Finds Claude Code processes of the current user that are not running inside any tmux pane.
 * These cannot be attached to from the browser, but they are worth showing so the list is honest.
 */
export async function listExternalClaudes(tmux: Tmux, ttyPrefix = "/dev/"): Promise<ExternalClaude[]> {
  let ps: string;
  try {
    ({ stdout: ps } = await execFileAsync("ps", ["-eo", "pid=,tty=,etimes=,args="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    return [];
  }

  // TTYs owned by tmux panes (any session, any server socket we know of) are excluded.
  const paneTtys = new Set<string>();
  try {
    const out = await tmux.run(["list-panes", "-a", "-F", "#{pane_tty}"]);
    for (const t of out.split("\n")) if (t) paneTtys.add(t.replace(ttyPrefix, ""));
  } catch {
    /* no tmux server: nothing to exclude */
  }

  const result: ExternalClaude[] = [];
  for (const row of parsePs(ps)) {
    if (row.pid === process.pid || !isClaudeCommand(row.args)) continue;
    if (row.tty === "?" || paneTtys.has(row.tty)) continue;
    let cwd: string;
    try {
      cwd = await fs.readlink(`/proc/${row.pid}/cwd`); // fails for other users' processes: skip them
    } catch {
      continue;
    }
    result.push({ pid: row.pid, tty: row.tty, workingDirectory: cwd, uptimeSeconds: row.etimes, args: row.args });
  }
  return result.sort((a, b) => b.uptimeSeconds - a.uptimeSeconds);
}
