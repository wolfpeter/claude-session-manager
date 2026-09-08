import { describe, it, expect } from "vitest";
import { parseListSessions, SEP } from "../src/tmux.js";
import { deriveStatus } from "../src/sessions.js";

describe("parseListSessions", () => {
  it("parses the custom format line by line", () => {
    const out = ["claude-api", "1700000000", "/p/api", "/p/api/src", "node", "0", "2"].join(SEP) + "\n" +
      ["other", "1700000001", "/home", "/home", "zsh", "0", "0"].join(SEP) + "\n";
    expect(parseListSessions(out)).toEqual([
      { name: "claude-api", created: 1700000000, path: "/p/api", panePath: "/p/api/src", paneCommand: "node", paneDead: false, attached: 2 },
      { name: "other", created: 1700000001, path: "/home", panePath: "/home", paneCommand: "zsh", paneDead: false, attached: 0 },
    ]);
    expect(parseListSessions("")).toEqual([]);
  });
});

describe("deriveStatus", () => {
  const base = { name: "x", created: 0, path: "/", panePath: "/", paneDead: false, attached: 0 };
  it("maps pane command to status", () => {
    expect(deriveStatus({ ...base, paneCommand: "claude" })).toBe("running");
    expect(deriveStatus({ ...base, paneCommand: "node" })).toBe("running");
    expect(deriveStatus({ ...base, paneCommand: "zsh" })).toBe("idle");
    expect(deriveStatus({ ...base, paneCommand: "zsh", paneDead: true })).toBe("stopped");
  });
});
