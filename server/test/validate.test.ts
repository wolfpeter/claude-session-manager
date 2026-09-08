import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isValidSessionId,
  slugify,
  validateName,
  validateWorkingDirectory,
  ValidationError,
} from "../src/validate.js";

describe("isValidSessionId", () => {
  it("accepts prefixed lowercase ids", () => {
    expect(isValidSessionId("claude-api", "claude-")).toBe(true);
    expect(isValidSessionId("claude-my_shop-2", "claude-")).toBe(true);
  });
  it("rejects ids without prefix, with shell chars or path parts", () => {
    expect(isValidSessionId("api", "claude-")).toBe(false);
    expect(isValidSessionId("claude-", "claude-")).toBe(false);
    expect(isValidSessionId("claude-a;rm -rf /", "claude-")).toBe(false);
    expect(isValidSessionId("claude-../x", "claude-")).toBe(false);
    expect(isValidSessionId("claude-Api", "claude-")).toBe(false);
    expect(isValidSessionId("claude-" + "a".repeat(65), "claude-")).toBe(false);
  });
});

describe("slugify", () => {
  it("turns names into tmux-safe slugs", () => {
    expect(slugify("API refactor")).toBe("api-refactor");
    expect(slugify("  Webshop / payment!! ")).toBe("webshop-payment");
    expect(slugify("Árvíztűrő tükörfúrógép")).toBe("arvizturo-tukorfurogep");
    expect(slugify("$$$")).toBe("");
  });
});

describe("validateName", () => {
  it("trims and accepts normal names", () => {
    expect(validateName("  API refactor ")).toBe("API refactor");
  });
  it("rejects empty, non-string and control chars", () => {
    expect(() => validateName("")).toThrow(ValidationError);
    expect(() => validateName(42)).toThrow(ValidationError);
    expect(() => validateName("a\nb")).toThrow(ValidationError);
  });
});

describe("validateWorkingDirectory", () => {
  it("accepts a directory inside an allowed root and rejects escapes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-root-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "csm-out-"));
    const inside = path.join(root, "proj");
    await fs.mkdir(inside);
    await fs.symlink(outside, path.join(root, "escape"));
    await fs.writeFile(path.join(root, "file.txt"), "x");

    await expect(validateWorkingDirectory(inside, [root])).resolves.toBe(await fs.realpath(inside));
    await expect(validateWorkingDirectory(root, [root])).resolves.toBe(await fs.realpath(root));
    await expect(validateWorkingDirectory(path.join(root, "proj", "..", "..", path.basename(outside)), [root]))
      .rejects.toThrow(/outside/);
    await expect(validateWorkingDirectory(path.join(root, "escape"), [root])).rejects.toThrow(/outside/);
    await expect(validateWorkingDirectory(path.join(root, "nope"), [root])).rejects.toThrow(/not exist/);
    await expect(validateWorkingDirectory(path.join(root, "file.txt"), [root])).rejects.toThrow(/not a directory/);
    await expect(validateWorkingDirectory("relative/path", [root])).rejects.toThrow(/absolute/);
    await expect(validateWorkingDirectory(root + "x", [root])).rejects.toThrow();
  });
});
