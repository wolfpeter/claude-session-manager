// Runs against a real tmux server on a private socket so the developer's own sessions are untouched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Tmux } from "../src/tmux.js";
import { SessionService } from "../src/sessions.js";
import type { Config } from "../src/config.js";

const socket = `csm-test-${process.pid}`;
const tmux = new Tmux("tmux", socket);
const silent = { info() {}, warn() {}, error() {} };
let root: string;
let config: Config;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-int-"));
  await fs.mkdir(path.join(root, "api"));
  config = {
    port: 0, host: "127.0.0.1", claudeCommand: "echo hello-from-claude", sessionPrefix: "claude-",
    allowedDirectories: [root], authToken: "", historyLines: 50, logLevel: "silent", tmuxSocket: socket, webDist: "",
    stallSeconds: 120,
    repoRoot: root, updateBranch: "main", updateCheckMinutes: 0,
  };
});

afterAll(async () => {
  await tmux.run(["kill-server"]).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
});

describe("SessionService with real tmux", () => {
  it("returns an empty list when no server is running", async () => {
    expect(await new SessionService(tmux, config, silent).list()).toEqual([]);
  });

  it("creates, discovers, deduplicates and removes sessions", async () => {
    const svc = new SessionService(tmux, config, silent);
    const s1 = await svc.create({ name: "API refactor", workingDirectory: path.join(root, "api") });
    expect(s1.id).toBe("claude-api-refactor");
    expect(s1.name).toBe("API refactor");
    expect(s1.workingDirectory).toBe(await fs.realpath(path.join(root, "api")));
    expect(["running", "idle"]).toContain(s1.status);

    const s2 = await svc.create({ name: "API refactor", workingDirectory: root });
    expect(s2.id).toBe("claude-api-refactor-2");

    // a manually created session with the prefix shows up too, with a fallback name
    await tmux.newSession("claude-manual", root);
    // a session without the prefix is ignored
    await tmux.newSession("unrelated", root);

    const ids = (await svc.list()).map((s) => s.id);
    expect(ids).toEqual(["claude-api-refactor", "claude-api-refactor-2", "claude-manual"]);
    expect((await svc.get("claude-manual")).name).toBe("manual");

    // the configured command really ran inside the session
    await new Promise((r) => setTimeout(r, 300));
    const hist = await tmux.run(["capture-pane", "-p", "-t", "=claude-api-refactor:", "-S", "-50"]);
    expect(hist).toContain("hello-from-claude");

    await svc.remove("claude-api-refactor-2");
    expect((await svc.list()).map((s) => s.id)).toEqual(["claude-api-refactor", "claude-manual"]);
    await expect(svc.remove("claude-api-refactor-2")).rejects.toThrow(/not found/i);
    await expect(svc.remove("unrelated")).rejects.toThrow(/Invalid session id/);
    await expect(svc.get("claude-nope")).rejects.toThrow(/not found/i);
  });

  it("reports what the pane is doing, read from the pane itself", async () => {
    const svc = new SessionService(tmux, config, silent);
    await tmux.newSession("claude-busy", root);
    await tmux.sendCommand(
      "claude-busy",
      `node -e "console.log('\u271d Brewing\u2026 (2m 0s \u00b7 8.9k tokens)'); setInterval(() => {}, 1000)"`,
    );
    await new Promise((r) => setTimeout(r, 800));

    const sessions = await svc.list();
    const busy = sessions.find((s) => s.id === "claude-busy");
    expect(busy?.status).toBe("running");
    expect(busy?.statusDetail).toBe("Brewing\u2026");
    expect(busy?.busyForSeconds).toBe(120);
    expect(Date.parse(busy?.lastActivityAt ?? "")).toBeGreaterThan(0);

    // a pane that is back to the shell is idle, whatever scrolled by earlier
    const shell = sessions.find((s) => s.id === "claude-manual");
    expect(shell?.status).toBe("idle");

    await svc.remove("claude-busy");
  });

  it("rejects bad input without touching tmux", async () => {
    const svc = new SessionService(tmux, config, silent);
    await expect(svc.create({ name: "x", workingDirectory: "/etc" })).rejects.toThrow(/outside/);
    await expect(svc.create({ name: "!!!", workingDirectory: root })).rejects.toThrow(/letter or digit/);
    await expect(svc.create({ name: "", workingDirectory: root })).rejects.toThrow(/required/);
  });
});
