import { describe, expect, test } from "vitest";
import { chipLabel, formatElapsed, needsYouCount, sortSessions, startedLabel, statusAge } from "../src/sessionView";
import type { ClaudeSession } from "../src/types";

const session = (over: Partial<ClaudeSession> & { id: string }): ClaudeSession => ({
  name: over.id,
  workingDirectory: "/p",
  status: "running",
  attached: 0,
  ...over,
});

const now = Date.parse("2026-09-16T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

describe("sortSessions", () => {
  test("puts the sessions that need a human first, quiet ones last", () => {
    const sessions = [
      session({ id: "idle", status: "idle" }),
      session({ id: "working", status: "running" }),
      session({ id: "waiting", status: "waiting" }),
      session({ id: "stuck", status: "stalled" }),
      session({ id: "asking", status: "needs_input" }),
      session({ id: "gone", status: "stopped" }),
    ];

    expect(sortSessions(sessions).map((s) => s.id)).toEqual(["asking", "stuck", "waiting", "working", "idle", "gone"]);
  });

  test("shows the longest wait first among sessions in the same state", () => {
    const sessions = [
      session({ id: "recent", status: "needs_input", statusSince: minutesAgo(2) }),
      session({ id: "oldest", status: "needs_input", statusSince: minutesAgo(40) }),
      session({ id: "middle", status: "needs_input", statusSince: minutesAgo(10) }),
    ];

    expect(sortSessions(sessions).map((s) => s.id)).toEqual(["oldest", "middle", "recent"]);
  });

  test("does not reorder the input array", () => {
    const sessions = [session({ id: "a", status: "idle" }), session({ id: "b", status: "needs_input" })];

    sortSessions(sessions);

    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("needsYouCount", () => {
  test("counts the sessions waiting on the user, not the working ones", () => {
    const sessions = [
      session({ id: "a", status: "needs_input" }),
      session({ id: "b", status: "waiting" }),
      session({ id: "c", status: "running" }),
      session({ id: "d", status: "stalled" }),
      session({ id: "e", status: "idle" }),
    ];

    expect(needsYouCount(sessions)).toBe(2);
  });
});

describe("formatElapsed", () => {
  test("keeps short waits precise and long ones short", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45)).toBe("45s");
    expect(formatElapsed(120)).toBe("2m");
    expect(formatElapsed(125)).toBe("2m 5s");
    expect(formatElapsed(3600)).toBe("1h");
    expect(formatElapsed(4500)).toBe("1h 15m");
  });
});

describe("statusAge", () => {
  test("reports how long a session has been busy, from the spinner", () => {
    const busy = session({ id: "a", status: "running", busyForSeconds: 125, lastActivityAt: minutesAgo(0) });

    expect(statusAge(busy, now)).toBe("2m 5s");
  });

  test("reports how long a session has been waiting, from when it entered the status", () => {
    // Claude redraws its input box while it waits, so the last output is not the start of the wait
    const waiting = session({ id: "a", status: "waiting", statusSince: minutesAgo(12), lastActivityAt: minutesAgo(0) });

    expect(statusAge(waiting, now)).toBe("12m");
  });

  test("says nothing when there is nothing to measure", () => {
    expect(statusAge(session({ id: "a", status: "idle" }), now)).toBe("");
  });
});

describe("startedLabel", () => {
  test("reads as a sentence for a session started moments ago", () => {
    expect(startedLabel(minutesAgo(0), now)).toBe("started just now");
  });

  test("gives the age for an older session", () => {
    expect(startedLabel(minutesAgo(140), now)).toBe("started 2h 20m ago");
  });
});

describe("chipLabel", () => {
  test("leaves a name that fits alone", () => {
    expect(chipLabel("api-gateway")).toBe("api-gateway");
  });

  test("shortens a long name to fit the switcher", () => {
    expect(chipLabel("claude-session-manager")).toBe("claude-sessio…");
  });

  test("does not leave a dangling separator at the cut", () => {
    expect(chipLabel("api-refactor-x")).toBe("api-refactor-x");
    expect(chipLabel("api refactor round two")).toBe("api refactor…");
  });
});
