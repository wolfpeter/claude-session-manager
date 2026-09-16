// Runs against real git repositories in a temp directory, and a real tmux server on a private socket.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Tmux } from "../src/tmux.js";
import { Updater } from "../src/updater.js";

const execFileAsync = promisify(execFile);
const socket = `csm-upd-${process.pid}`;
const tmux = new Tmux("tmux", socket);
const silent = { info() {}, warn() {}, error() {} };

let root: string;
let origin: string;
let checkout: string;

const git = (cwd: string, ...args: string[]) => execFileAsync("git", ["-C", cwd, ...args]);

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-upd-"));
  origin = path.join(root, "origin");
  checkout = path.join(root, "checkout");

  // an "upstream" with one commit, then a clone of it
  await fs.mkdir(origin);
  await git(origin, "init", "--quiet", "--initial-branch=main");
  await git(origin, "config", "user.email", "test@example.com");
  await git(origin, "config", "user.name", "Test");
  await fs.writeFile(path.join(origin, "README.md"), "one\n");
  await git(origin, "add", "-A");
  await git(origin, "commit", "--quiet", "-m", "first");
  await execFileAsync("git", ["clone", "--quiet", origin, checkout]);
  await fs.writeFile(path.join(checkout, "deploy.sh"), "#!/bin/sh\necho deploying\n", { mode: 0o755 });
});

afterAll(async () => {
  await tmux.run(["kill-server"]).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
});

describe("Updater", () => {
  it("reports no update while the checkout matches the remote", async () => {
    const status = await new Updater(checkout, "main", silent).status();

    expect(status.supported).toBe(true);
    expect(status.available).toBe(false);
    expect(status.behind).toBe(0);
    expect(status.dirty).toBe(false);
    expect(status.current).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("counts how many commits the remote is ahead by, once it has fetched", async () => {
    await fs.writeFile(path.join(origin, "README.md"), "two\n");
    await git(origin, "commit", "--quiet", "-am", "second");

    const updater = new Updater(checkout, "main", silent);
    expect((await updater.status()).behind).toBe(0); // not fetched yet: the checkout knows nothing

    await updater.check();
    const status = await updater.status();

    expect(status.behind).toBe(1);
    expect(status.available).toBe(true);
    expect(Date.parse(status.checkedAt ?? "")).toBeGreaterThan(0);
  });

  it("notices local changes, because deploy.sh cannot fast-forward over them", async () => {
    await fs.writeFile(path.join(checkout, "README.md"), "edited locally\n");

    expect((await new Updater(checkout, "main", silent).status()).dirty).toBe(true);

    await git(checkout, "checkout", "--", "README.md");
  });

  it("reports unsupported outside a git checkout instead of failing", async () => {
    const plain = path.join(root, "plain");
    await fs.mkdir(plain);

    const status = await new Updater(plain, "main", silent).status();

    expect(status.supported).toBe(false);
    expect(status.available).toBe(false);
  });

  it("runs the update in a tmux session the browser can attach to", async () => {
    const updater = new Updater(checkout, "main", silent);

    const id = await updater.start(tmux, "claude-update");

    expect(id).toBe("claude-update");
    expect(await tmux.hasSession("claude-update")).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(await tmux.capturePane("claude-update")).toContain("deploying");

    // a second click while it runs attaches to the same session instead of starting another
    expect(await updater.start(tmux, "claude-update")).toBe("claude-update");
  });
});
