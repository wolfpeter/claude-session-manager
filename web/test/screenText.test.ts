import { describe, expect, test } from "vitest";
import { screenText } from "../src/screenText";

/**
 * The slice of xterm's API screenText needs: the visible rows of the active buffer.
 * getLine reads its data through `this`, exactly like xterm's own implementation does - pull the
 * method off the object and it throws, which is a real way to break this.
 */
const fakeTerm = (lines: (string | undefined)[], rows = lines.length, viewportY = 0) => ({
  rows,
  buffer: {
    active: {
      viewportY,
      lines,
      getLine(this: { lines: (string | undefined)[]; viewportY: number }, index: number) {
        const line = this.lines[index - this.viewportY];
        return line === undefined ? undefined : { translateToString: () => line };
      },
    },
  },
});

describe("screenText", () => {
  test("returns what is on the screen, one line per row", () => {
    const term = fakeTerm(["first line", "second line", "third line"]);

    expect(screenText(term)).toBe("first line\nsecond line\nthird line");
  });

  test("reads from where the view is scrolled to, not from the top of the buffer", () => {
    const term = fakeTerm(["visible one", "visible two"], 2, 40);

    expect(screenText(term)).toBe("visible one\nvisible two");
  });

  test("drops the blank padding at the bottom of the screen", () => {
    const term = fakeTerm(["output", "", "   ", ""]);

    expect(screenText(term)).toBe("output");
  });

  test("keeps blank lines that sit between content", () => {
    const term = fakeTerm(["one", "", "two"]);

    expect(screenText(term)).toBe("one\n\ntwo");
  });

  test("trims the trailing spaces a terminal pads its rows with", () => {
    const term = fakeTerm(["padded line          "]);

    expect(screenText(term)).toBe("padded line");
  });

  test("survives rows the buffer cannot give back", () => {
    const term = fakeTerm(["kept", undefined, "also kept"]);

    expect(screenText(term)).toBe("kept\n\nalso kept");
  });
});
