/**
 * Copy-on-select for the terminal, the way a terminal emulator does it: let go of the drag and the
 * selection is already on the clipboard.
 *
 * xterm keeps its own selection and copies nothing on its own, so without this a selection is only
 * text on a screen. The copy happens once the selection stops changing - a drag reports every cell
 * it crosses, and copying each of those would put half-finished text on the clipboard. The wait is
 * short enough to stay inside the browser's user-activation window, which is what lets the
 * `execCommand` fallback (the path over plain HTTP, see clipboard.ts) run at all.
 */
export interface SelectionSource {
  hasSelection(): boolean;
  getSelection(): string;
  onSelectionChange(handler: () => void): { dispose(): void };
}

export interface SelectionCopyOptions {
  /** Puts text on the clipboard; returns whether it worked. */
  copy: (text: string) => Promise<boolean>;
  /** Every change of the selection, `""` when it is gone. Drives the copy button. */
  onSelection?: (text: string) => void;
  /** The outcome of an automatic copy. */
  onCopied?: (ok: boolean, text: string) => void;
  /** How long the selection must hold still before it is copied. */
  settleMs?: number;
}

const SETTLE_MS = 120;

export function watchSelectionCopy(term: SelectionSource, opts: SelectionCopyOptions): { dispose(): void } {
  const settleMs = opts.settleMs ?? SETTLE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // What is on the clipboard already: xterm re-reports the same selection on redraws, and the
  // clipboard should not be rewritten (nor the button re-flashed) for that.
  let copied = "";

  const sub = term.onSelectionChange(() => {
    const text = term.hasSelection() ? term.getSelection() : "";
    opts.onSelection?.(text);
    clearTimeout(timer);
    if (!text.trim()) {
      // Selecting the same text again after letting go is a deliberate second copy.
      copied = "";
      return;
    }
    timer = setTimeout(() => void settle(text), settleMs);
  });

  const settle = async (text: string) => {
    // Already on the clipboard (xterm re-reports a selection on every redraw): say so, copy nothing.
    if (text === copied) {
      opts.onCopied?.(true, text);
      return;
    }
    const ok = await opts.copy(text);
    // A failed copy is not remembered, so the button can retry the same selection.
    if (ok) copied = text;
    opts.onCopied?.(ok, text);
  };

  return {
    dispose() {
      clearTimeout(timer);
      sub.dispose();
    },
  };
}
