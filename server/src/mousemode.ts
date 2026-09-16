/**
 * Strips terminal mouse-reporting mode changes from the stream sent to a browser client.
 *
 * Claude Code turns on mouse tracking (any-event + SGR). While that is on, xterm.js hands every
 * drag to the application instead of selecting text, so copying from the browser needs Shift - and
 * on a touch screen it is impossible. Browser clients get no useful mouse interaction with a TUI
 * anyway, so the sequences are removed before xterm sees them: the terminal stays in plain mode
 * and a drag selects text like anywhere else. tmux and Claude are untouched; only this client's
 * view of the mode changes.
 */

/** DEC private modes for mouse reporting: X10/VT200 tracking, motion, and the encodings. */
const MOUSE_MODES = new Set([9, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1015, 1016]);

/** A complete DEC private mode sequence: ESC [ ? params (h|l) */
const PRIVATE_MODE = /\x1b\[\?([0-9;]*)([hl])/g;

/** Longest tail worth holding back while waiting for the rest of a sequence. */
const MAX_PARTIAL = 24;

export class MouseModeFilter {
  /** Bytes at the end of the last chunk that may be the start of a mode sequence. */
  private carry = "";

  /** Feeds one chunk of terminal output through the filter. */
  push(chunk: string): string {
    const text = this.carry + chunk;
    this.carry = "";

    const held = partialSequenceAt(text);
    const body = held === -1 ? text : text.slice(0, held);
    if (held !== -1) this.carry = text.slice(held);

    return body.replace(PRIVATE_MODE, (whole, params: string, action: string) => {
      const kept = params.split(";").filter((p) => p !== "" && !MOUSE_MODES.has(Number(p)));
      if (kept.length === params.split(";").filter((p) => p !== "").length) return whole;
      return kept.length ? `\x1b[?${kept.join(";")}${action}` : "";
    });
  }
}

/**
 * Index where an unfinished `ESC [ ? params` tail starts, or -1 when the chunk ends cleanly.
 * Anything longer than MAX_PARTIAL is not a mode sequence, so it is passed through rather than held.
 */
function partialSequenceAt(text: string): number {
  const start = text.lastIndexOf("\x1b");
  if (start === -1 || text.length - start > MAX_PARTIAL) return -1;
  const tail = text.slice(start);
  return /^\x1b(\[(\?[0-9;]*)?)?$/.test(tail) ? start : -1;
}
