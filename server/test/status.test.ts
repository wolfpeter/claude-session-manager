import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { classifyPane, SessionWatch } from "../src/status.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");

/** A live Claude pane: the process runs and the screen changed a second ago. */
const live = { paneDead: false, paneCommand: "claude", secondsSinceChange: 1 };

describe("classifyPane", () => {
  test("reports running while the spinner is ticking", () => {
    const result = classifyPane({ ...live, text: fixture("pane-spinner") });

    expect(result.status).toBe("running");
    expect(result.detail).toContain("Brewing");
    expect(result.busyForSeconds).toBe(120);
  });

  test("counts a pane running node as Claude, not as a shell", () => {
    const result = classifyPane({ ...live, paneCommand: "node", text: fixture("pane-spinner") });

    expect(result.status).toBe("running");
  });

  test("stays running while a subagent works, however long it takes", () => {
    const text = "✻ Cogitating… (12m 30s · ↑ 45.1k tokens · esc to interrupt)\n  ⎿  Running 2 agents…\n";

    const result = classifyPane({ ...live, text }, { stallSeconds: 120 });

    expect(result.status).toBe("running");
    expect(result.busyForSeconds).toBe(750);
  });

  test("reports stalled when a busy pane produced no output for longer than the threshold", () => {
    const result = classifyPane(
      { ...live, secondsSinceChange: 300, text: fixture("pane-spinner") },
      { stallSeconds: 120 },
    );

    expect(result.status).toBe("stalled");
  });

  test("reports needs_input at a multiple choice question", () => {
    const result = classifyPane({ ...live, secondsSinceChange: 181, text: fixture("pane-question-menu") });

    expect(result.status).toBe("needs_input");
    expect(result.detail).toBe("Choose an option");
  });

  test("reports needs_input at a permission request", () => {
    const text = [
      "│ Bash command                                            │",
      "│   rm -rf build                                          │",
      "│                                                         │",
      "│ Do you want to proceed?                                 │",
      "│ ❯ 1. Yes                                                │",
      "│   2. No, and tell Claude what to do differently (esc)    │",
    ].join("\n");

    const result = classifyPane({ ...live, text });

    expect(result.status).toBe("needs_input");
    expect(result.detail).toBe("Permission request");
  });

  test("reports needs_input at the folder trust prompt", () => {
    const result = classifyPane({ ...live, text: fixture("pane-trust-dialog") });

    expect(result.status).toBe("needs_input");
    expect(result.detail).toBe("Folder trust prompt");
  });

  test("prefers the question over a spinner left above it on screen", () => {
    const text = `✽ Brewing… (34s · ↓ 2.1k tokens)\n${fixture("pane-question-menu")}`;

    const result = classifyPane({ ...live, text });

    expect(result.status).toBe("needs_input");
  });

  test("reports waiting at an empty prompt", () => {
    const result = classifyPane({ ...live, secondsSinceChange: 600, text: fixture("pane-idle-prompt") });

    expect(result.status).toBe("waiting");
  });

  test("reports idle when only the shell is left", () => {
    const result = classifyPane({ ...live, paneCommand: "zsh", text: fixture("pane-shell") });

    expect(result.status).toBe("idle");
  });

  test("reports stopped for a dead pane", () => {
    const result = classifyPane({ ...live, paneDead: true, text: fixture("pane-spinner") });

    expect(result.status).toBe("stopped");
  });

  test("falls back to running on an unrecognised pane that keeps producing output", () => {
    const result = classifyPane({ ...live, secondsSinceChange: 2, text: "some screen we do not know\n" });

    expect(result.status).toBe("running");
  });

  test("falls back to waiting on an unrecognised pane that went quiet", () => {
    const result = classifyPane({ ...live, secondsSinceChange: 90, text: "some screen we do not know\n" });

    expect(result.status).toBe("waiting");
  });
});

describe("SessionWatch", () => {
  test("keeps the timestamp while a session stays in the same status", () => {
    const watch = new SessionWatch();

    const first = watch.markStatus("claude-a", "needs_input", 1_000_000);
    const later = watch.markStatus("claude-a", "needs_input", 1_600_000);

    expect(later).toBe(first);
  });

  test("restarts the timestamp when the status changes", () => {
    const watch = new SessionWatch();
    watch.markStatus("claude-a", "running", 1_000_000);

    expect(watch.markStatus("claude-a", "needs_input", 1_600_000)).toBe(1_600_000);
  });

  test("forgets sessions that are gone instead of growing forever", () => {
    const watch = new SessionWatch();
    watch.markStatus("claude-a", "needs_input", 1_000_000);
    watch.observePane("claude-a", "screen one", 1_000_000);

    watch.retain(["claude-b"]);

    expect(watch.markStatus("claude-a", "needs_input", 1_600_000)).toBe(1_600_000);
    expect(watch.observePane("claude-a", "screen one", 1_600_000).changedAt).toBe(1_600_000);
  });

  test("counts a changed screen as the session being alive", () => {
    const watch = new SessionWatch();
    watch.observePane("claude-a", "spinner 1s", 1_000_000);

    const seen = watch.observePane("claude-a", "spinner 9s", 1_030_000);

    expect(seen.changedAt).toBe(1_030_000);
    expect(seen.secondsSinceChange).toBe(0);
  });

  test("measures how long an unchanged screen has been frozen", () => {
    const watch = new SessionWatch();
    watch.observePane("claude-a", "spinner 1s", 1_000_000);

    const seen = watch.observePane("claude-a", "spinner 1s", 1_300_000);

    expect(seen.changedAt).toBe(1_000_000);
    expect(seen.secondsSinceChange).toBe(300);
  });
});
