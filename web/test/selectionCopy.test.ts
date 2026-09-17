import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { watchSelectionCopy } from "../src/selectionCopy";

/** The slice of xterm's API the watcher uses, plus a way to drive a selection from a test. */
function fakeTerm() {
  let handler: (() => void) | null = null;
  let text = "";
  return {
    hasSelection: () => text.length > 0,
    getSelection: () => text,
    onSelectionChange(cb: () => void) {
      handler = cb;
      return {
        dispose() {
          handler = null;
        },
      };
    },
    /** Pretend the user changed the selection; a drag fires this once per cell. */
    select(next: string) {
      text = next;
      handler?.();
    },
  };
}

describe("watchSelectionCopy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("copies the selection once it stops changing", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    const onCopied = vi.fn();
    watchSelectionCopy(term, { copy, onCopied, settleMs: 100 });

    // A drag reports every intermediate selection; only the final one is worth copying.
    term.select("er");
    term.select("error: boo");
    await vi.advanceTimersByTimeAsync(100);

    expect(copy.mock.calls).toEqual([["error: boo"]]);
    expect(onCopied).toHaveBeenCalledWith(true, "error: boo");
  });

  test("copies nothing while the drag is still moving", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    watchSelectionCopy(term, { copy, settleMs: 100 });

    term.select("err");
    await vi.advanceTimersByTimeAsync(60);
    term.select("error");
    await vi.advanceTimersByTimeAsync(60);

    expect(copy).not.toHaveBeenCalled();
  });

  test("reports the live selection so the copy button can follow it", async () => {
    const term = fakeTerm();
    const onSelection = vi.fn();
    watchSelectionCopy(term, { copy: vi.fn().mockResolvedValue(true), onSelection, settleMs: 100 });

    term.select("error");
    term.select("");

    expect(onSelection.mock.calls).toEqual([["error"], [""]]);
  });

  test("copies nothing when the selection is cleared or blank", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    watchSelectionCopy(term, { copy, settleMs: 100 });

    term.select("   ");
    await vi.advanceTimersByTimeAsync(100);
    term.select("");
    await vi.advanceTimersByTimeAsync(100);

    expect(copy).not.toHaveBeenCalled();
  });

  test("does not copy the same selection twice", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    watchSelectionCopy(term, { copy, settleMs: 100 });

    term.select("error");
    await vi.advanceTimersByTimeAsync(100);
    // xterm re-reports the same selection on a redraw; the clipboard should not be touched again.
    term.select("error");
    await vi.advanceTimersByTimeAsync(100);

    expect(copy).toHaveBeenCalledTimes(1);
  });

  test("a selection that is already on the clipboard still reads as copied", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    const onCopied = vi.fn();
    watchSelectionCopy(term, { copy, onCopied, settleMs: 100 });

    term.select("error");
    await vi.advanceTimersByTimeAsync(100);
    term.select("error");
    await vi.advanceTimersByTimeAsync(100);

    // The button says "copied" both times, even though the clipboard was written once.
    expect(onCopied.mock.calls).toEqual([[true, "error"], [true, "error"]]);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  test("selecting the same text again after clearing copies it again", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    watchSelectionCopy(term, { copy, settleMs: 100 });

    term.select("error");
    await vi.advanceTimersByTimeAsync(100);
    term.select("");
    term.select("error");
    await vi.advanceTimersByTimeAsync(100);

    expect(copy).toHaveBeenCalledTimes(2);
  });

  test("a failed copy is reported and left to be retried", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(false);
    const onCopied = vi.fn();
    watchSelectionCopy(term, { copy, onCopied, settleMs: 100 });

    term.select("error");
    await vi.advanceTimersByTimeAsync(100);
    expect(onCopied).toHaveBeenCalledWith(false, "error");

    // Not remembered as copied, so the same selection may be tried again (the button does this).
    term.select("error");
    await vi.advanceTimersByTimeAsync(100);
    expect(copy).toHaveBeenCalledTimes(2);
  });

  test("dispose stops both the pending copy and the subscription", async () => {
    const term = fakeTerm();
    const copy = vi.fn().mockResolvedValue(true);
    const watcher = watchSelectionCopy(term, { copy, settleMs: 100 });

    term.select("error");
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(100);
    term.select("more");
    await vi.advanceTimersByTimeAsync(100);

    expect(copy).not.toHaveBeenCalled();
  });
});
