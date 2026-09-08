import { describe, it, expect } from "vitest";
import { isClaudeCommand, parsePs } from "../src/external.js";

describe("parsePs", () => {
  it("parses pid, tty, elapsed seconds and the command line", () => {
    const out = "3812639 pts/0        7201 claude --dangerously-skip-permissions\n" +
      "   1234 ?             55 /usr/bin/zsh\n" +
      "garbage line\n";
    expect(parsePs(out)).toEqual([
      { pid: 3812639, tty: "pts/0", etimes: 7201, args: "claude --dangerously-skip-permissions" },
      { pid: 1234, tty: "?", etimes: 55, args: "/usr/bin/zsh" },
    ]);
  });
});

describe("isClaudeCommand", () => {
  it("matches the claude CLI in its usual forms only", () => {
    expect(isClaudeCommand("claude")).toBe(true);
    expect(isClaudeCommand("claude --dangerously-skip-permissions")).toBe(true);
    expect(isClaudeCommand("/usr/bin/claude --resume")).toBe(true);
    expect(isClaudeCommand("node /home/x/.npm-global/bin/claude")).toBe(true);
    expect(isClaudeCommand("node server/dist/index.js")).toBe(false);
    expect(isClaudeCommand("grep claude")).toBe(false);
    expect(isClaudeCommand("claude-session-manager")).toBe(false);
    expect(isClaudeCommand("/usr/bin/zsh")).toBe(false);
  });
});
