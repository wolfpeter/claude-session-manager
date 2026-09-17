export interface FolderOption {
  path: string;
  label: string;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/**
 * Turns absolute project paths into dropdown entries. The folder's own name is enough to tell them
 * apart, except when two allowed roots hold a folder of the same name: those keep the full path.
 */
export function folderOptions(paths: string[]): FolderOption[] {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(basename(p), (counts.get(basename(p)) ?? 0) + 1);
  return paths.map((p) => ({ path: p, label: (counts.get(basename(p)) ?? 0) > 1 ? p : basename(p) }));
}

/** The remembered choice if it is still on offer, otherwise the first one (or nothing at all). */
export function pickRemembered(remembered: string | null, offered: string[]): string {
  if (remembered && offered.includes(remembered)) return remembered;
  return offered[0] ?? "";
}
