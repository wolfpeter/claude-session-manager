import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listProjectDirectories } from "../src/projects.js";

describe("listProjectDirectories", () => {
  it("lists the direct subdirectories of every root, skipping hidden entries and files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-proj-"));
    await fs.mkdir(path.join(root, "webapp"));
    await fs.mkdir(path.join(root, "Admin"));
    await fs.mkdir(path.join(root, "webapp", "nested"));
    await fs.mkdir(path.join(root, ".hidden"));
    await fs.writeFile(path.join(root, "notes.txt"), "x");

    expect(await listProjectDirectories([root])).toEqual([
      path.join(root, "Admin"),
      path.join(root, "webapp"),
    ]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("follows symlinked directories and ignores unreadable roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-proj-"));
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "csm-other-"));
    await fs.symlink(other, path.join(root, "linked"));
    await fs.symlink(path.join(root, "nowhere"), path.join(root, "broken"));

    expect(await listProjectDirectories([root, path.join(root, "does-not-exist")])).toEqual([
      path.join(root, "linked"),
    ]);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(other, { recursive: true, force: true });
  });

  it("merges several roots and drops duplicates", async () => {
    const a = await fs.mkdtemp(path.join(os.tmpdir(), "csm-a-"));
    const b = await fs.mkdtemp(path.join(os.tmpdir(), "csm-b-"));
    await fs.mkdir(path.join(a, "one"));
    await fs.mkdir(path.join(b, "two"));

    expect(await listProjectDirectories([a, b, a])).toEqual([path.join(a, "one"), path.join(b, "two")]);
    await fs.rm(a, { recursive: true, force: true });
    await fs.rm(b, { recursive: true, force: true });
  });
});
