/**
 * The visible screen as text, for copying without a selection.
 *
 * Needed because a selection is not always possible: Claude Code turns on the terminal's mouse
 * reporting, so a plain drag goes to Claude instead of selecting (Shift+drag still selects), and
 * on a touch screen xterm has no selection at all. In both cases this is what the user actually
 * wants to copy - the error message or command that is on screen right now.
 */
export interface ReadableTerminal {
  rows: number;
  buffer: {
    active: {
      viewportY: number;
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

export function screenText(term: ReadableTerminal): string {
  // Call getLine on the buffer, never through a local alias: xterm's implementation reads its
  // data off `this`, so a detached reference throws.
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < term.rows; row++) {
    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true).replace(/\s+$/, "") ?? "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
