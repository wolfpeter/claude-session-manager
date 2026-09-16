import { describe, expect, test, vi } from "vitest";
import { copyText } from "../src/clipboard";

describe("copyText", () => {
  test("uses the clipboard API when the page has one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCopy = vi.fn().mockReturnValue(true);

    const copied = await copyText("hello", { clipboard: { writeText }, execCopy });

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCopy).not.toHaveBeenCalled();
  });

  test("falls back to the old copy command when the page is not a secure context", async () => {
    // navigator.clipboard only exists on HTTPS and localhost; over http://<lan-ip> it is undefined
    const execCopy = vi.fn().mockReturnValue(true);

    const copied = await copyText("hello", { clipboard: undefined, execCopy });

    expect(copied).toBe(true);
    expect(execCopy).toHaveBeenCalledWith("hello");
  });

  test("falls back when the clipboard API rejects, for example without permission", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const execCopy = vi.fn().mockReturnValue(true);

    const copied = await copyText("hello", { clipboard: { writeText }, execCopy });

    expect(copied).toBe(true);
    expect(execCopy).toHaveBeenCalledWith("hello");
  });

  test("reports failure when neither way works", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("nope"));

    const copied = await copyText("hello", { clipboard: { writeText }, execCopy: () => false });

    expect(copied).toBe(false);
  });

  test("does nothing for an empty selection", async () => {
    const writeText = vi.fn();
    const execCopy = vi.fn();

    const copied = await copyText("", { clipboard: { writeText }, execCopy });

    expect(copied).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCopy).not.toHaveBeenCalled();
  });
});
