import { describe, it, expect } from "vitest";
import { parseListSessions, SEP } from "../src/tmux.js";

describe("parseListSessions", () => {
  it("parses the custom format line by line", () => {
    const out = ["claude-api", "1700000000", "/p/api", "/p/api/src", "node", "0", "2", "API refactor"].join(SEP) + "\n" +
      ["other", "1700000001", "/home", "/home", "zsh", "0", "0", ""].join(SEP) + "\n";
    expect(parseListSessions(out)).toEqual([
      { name: "claude-api", created: 1700000000, path: "/p/api", panePath: "/p/api/src", paneCommand: "node", paneDead: false, attached: 2, displayName: "API refactor" },
      { name: "other", created: 1700000001, path: "/home", panePath: "/home", paneCommand: "zsh", paneDead: false, attached: 0, displayName: "" },
    ]);
    expect(parseListSessions("")).toEqual([]);
  });
});
