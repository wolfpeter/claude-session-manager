// End-to-end over HTTP + WebSocket against a real tmux server on a private socket.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { Tmux } from "../src/tmux.js";
import type { Config } from "../src/config.js";
import type { ClaudeSession } from "../src/types.js";

const socket = `csm-app-${process.pid}`;
const tmux = new Tmux("tmux", socket);
let app: FastifyInstance;
let base: string;
let root: string;

function collect(ws: WebSocket, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    ws.on("message", (data, isBinary) => {
      if (isBinary) buf += data.toString("utf8");
    });
    setTimeout(() => resolve(buf), ms);
  });
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-app-"));
  const config: Config = {
    port: 0, host: "127.0.0.1", claudeCommand: "cat", sessionPrefix: "claude-",
    allowedDirectories: [root], authToken: "secret", historyLines: 100, logLevel: "silent",
    tmuxSocket: socket, webDist: "", stallSeconds: 120,
  };
  app = await buildApp(config);
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
  await tmux.run(["kill-server"]).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
});

const H = { "x-api-key": "secret", "content-type": "application/json" };
const A = { "x-api-key": "secret" };

describe("REST API", () => {
  it("requires the token when AUTH_TOKEN is set", async () => {
    expect((await fetch(`${base}/api/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/api/sessions?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/api/sessions?token=secret`)).status).toBe(200);
  });

  it("creates, lists, gets and deletes sessions with validation", async () => {
    let res = await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ name: "Shop", workingDirectory: root }) });
    expect(res.status).toBe(201);
    const s = (await res.json()) as ClaudeSession;
    expect(s.id).toBe("claude-shop");
    expect(s.name).toBe("Shop");

    res = await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ name: "Evil", workingDirectory: "/" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/outside/);

    res = await fetch(`${base}/api/sessions`, { headers: H });
    expect(((await res.json()) as ClaudeSession[]).map((x) => x.id)).toEqual(["claude-shop"]);

    expect((await fetch(`${base}/api/sessions/claude-shop`, { headers: H })).status).toBe(200);
    expect((await fetch(`${base}/api/sessions/claude-nope`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/sessions/..%2Fetc`, { headers: H })).status).toBe(400);

    expect((await fetch(`${base}/api/sessions/claude-shop`, { method: "DELETE", headers: A })).status).toBe(204);
    expect((await fetch(`${base}/api/sessions/claude-shop`, { method: "DELETE", headers: A })).status).toBe(404);
    expect(await tmux.hasSession("claude-shop")).toBe(false);
  });
});

describe("WebSocket terminal", () => {
  it("rejects unknown sessions", async () => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/sessions/claude-missing?token=secret`);
    const code = await new Promise<number>((resolve) => ws.on("close", (c) => resolve(c)));
    expect(code).toBe(4004);
  });

  it("is interactive: typed input echoes back, resize reaches tmux, detach keeps the session alive", async () => {
    // `cat` as the "claude" command: echoes every line we type, good enough to prove the round trip.
    const res = await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ name: "Term", workingDirectory: root }) });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 300));

    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/sessions/claude-term?token=secret&cols=100&rows=30`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    const outputP = collect(ws, 1200);
    setTimeout(() => ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 })), 100);
    setTimeout(() => ws.send(JSON.stringify({ type: "input", data: "ping-from-browser\r" })), 400);
    const output = await outputP;
    expect(output).toContain("ping-from-browser");

    // the attached tmux client must have taken the resized dimensions (window is one row shorter: status bar)
    const size = await tmux.run(["list-clients", "-t", "=claude-term", "-F", "#{client_width}x#{client_height}"]);
    expect(size.trim()).toBe("120x40");

    const attachedBefore = (await tmux.listSessions()).find((s) => s.name === "claude-term")?.attached;
    expect(attachedBefore).toBe(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(await tmux.hasSession("claude-term")).toBe(true);
    const attachedAfter = (await tmux.listSessions()).find((s) => s.name === "claude-term")?.attached;
    expect(attachedAfter).toBe(0);

    // reconnect: the earlier line is still on screen (tmux redraw / history)
    const ws2 = new WebSocket(`${base.replace("http", "ws")}/ws/sessions/claude-term?token=secret&cols=100&rows=30`);
    await new Promise<void>((resolve) => ws2.on("open", () => resolve()));
    const again = await collect(ws2, 800);
    expect(again).toContain("ping-from-browser");
    ws2.close();
  });
});
