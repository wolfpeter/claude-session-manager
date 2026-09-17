import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig profiles", () => {
  it("falls back to a single profile built from CLAUDE_COMMAND", () => {
    expect(loadConfig({}).claudeProfiles).toEqual([{ id: "default", label: "Default", command: "claude" }]);
    expect(loadConfig({ CLAUDE_COMMAND: "claude --continue" }).claudeProfiles).toEqual([
      { id: "default", label: "Default", command: "claude --continue" },
    ]);
  });

  it("parses labelled profiles and keeps their order", () => {
    const env = { CLAUDE_PROFILES: "Alap=claude | Engedélyek nélkül = claude --dangerously-skip-permissions" };
    expect(loadConfig(env).claudeProfiles).toEqual([
      { id: "alap", label: "Alap", command: "claude" },
      { id: "engedelyek-nelkul", label: "Engedélyek nélkül", command: "claude --dangerously-skip-permissions" },
    ]);
  });

  it("splits on the first = only, so the command may contain one", () => {
    expect(loadConfig({ CLAUDE_PROFILES: "Env=FOO=bar claude" }).claudeProfiles).toEqual([
      { id: "env", label: "Env", command: "FOO=bar claude" },
    ]);
  });

  it("gives colliding or unsluggable labels a positional id", () => {
    const profiles = loadConfig({ CLAUDE_PROFILES: "Alap=claude|Alap=claude -c|!!!=claude -r" }).claudeProfiles;
    expect(profiles.map((p) => p.id)).toEqual(["alap", "profile-2", "profile-3"]);
  });

  it("rejects entries without a label or a command", () => {
    expect(() => loadConfig({ CLAUDE_PROFILES: "claude" })).toThrow(/CLAUDE_PROFILES/);
    expect(() => loadConfig({ CLAUDE_PROFILES: "Alap=" })).toThrow(/CLAUDE_PROFILES/);
    expect(() => loadConfig({ CLAUDE_PROFILES: "=claude" })).toThrow(/CLAUDE_PROFILES/);
  });

  it("treats an empty value as unset and tolerates a trailing separator", () => {
    expect(loadConfig({ CLAUDE_PROFILES: "   " }).claudeProfiles).toEqual([
      { id: "default", label: "Default", command: "claude" },
    ]);
    expect(loadConfig({ CLAUDE_PROFILES: "Alap=claude|" }).claudeProfiles).toEqual([
      { id: "alap", label: "Alap", command: "claude" },
    ]);
  });
});
