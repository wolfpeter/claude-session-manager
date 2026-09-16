/**
 * Copying out of the terminal.
 *
 * xterm.js keeps its own selection, so nothing reaches the clipboard unless the page puts it
 * there. `navigator.clipboard` only exists in a secure context (HTTPS or localhost), and this app
 * is usually opened over plain HTTP on a LAN or Tailscale address, so the old textarea +
 * execCommand route is not a nicety here: it is the path that actually runs.
 */
export interface ClipboardDeps {
  clipboard?: { writeText(text: string): Promise<void> };
  execCopy?: (text: string) => boolean;
}

/** Puts `text` on the clipboard the best way this page can. Returns whether it worked. */
export async function copyText(text: string, deps: ClipboardDeps = browserDeps()): Promise<boolean> {
  if (!text) return false;

  if (deps.clipboard) {
    try {
      await deps.clipboard.writeText(text);
      return true;
    } catch {
      /* no permission, or a browser that only pretends to have the API: try the old way */
    }
  }
  return deps.execCopy ? deps.execCopy(text) : false;
}

function browserDeps(): ClipboardDeps {
  return { clipboard: navigator.clipboard, execCopy: execCopyViaTextarea };
}

/** document.execCommand("copy") is deprecated but it is the only one that works over plain HTTP. */
function execCopyViaTextarea(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  // Off-screen but focusable: display:none or hidden would make the selection impossible.
  area.style.cssText = "position:fixed;top:-1000px;opacity:0";
  area.setAttribute("readonly", "");
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
