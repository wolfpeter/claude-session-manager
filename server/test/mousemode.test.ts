import { describe, expect, test } from "vitest";
import { MouseModeFilter } from "../src/mousemode.js";

const run = (chunks: string[]): string => {
  const filter = new MouseModeFilter();
  return chunks.map((c) => filter.push(c)).join("");
};

describe("MouseModeFilter", () => {
  test("leaves ordinary output alone", () => {
    expect(run(["hello [31mred[0m world\r\n"])).toBe("hello [31mred[0m world\r\n");
  });

  test("removes the mouse tracking modes Claude Code turns on", () => {
    // any-event tracking + SGR encoding: what a live Claude session sets
    expect(run(["before[?1003h[?1006hafter"])).toBe("beforeafter");
    expect(run(["[?1000h[?1002h"])).toBe("");
  });

  test("removes the matching disable sequences too, so nothing is left half-set", () => {
    expect(run(["x[?1003l[?1006ly"])).toBe("xy");
  });

  test("keeps private modes that are none of our business", () => {
    // cursor visibility and the alternate screen must pass through untouched
    expect(run(["[?25l text [?1049h"])).toBe("[?25l text [?1049h");
  });

  test("keeps the non-mouse half of a combined mode sequence", () => {
    expect(run(["[?1000;25h"])).toBe("[?25h");
    expect(run(["[?25;1006h"])).toBe("[?25h");
  });

  test("filters a sequence that arrives split across two chunks", () => {
    expect(run(["text[?10", "03htail"])).toBe("texttail");
    expect(run(["a", "[?1006h", "b"])).toBe("ab");
  });

  test("does not swallow a lone escape that turns out to be something else", () => {
    expect(run(["", "[A"])).toBe("[A");
  });

  test("gives up holding back after a run of bytes that is not a mode sequence", () => {
    const long = "[?" + "9".repeat(40);
    expect(run([long])).toBe(long);
  });
});
