import fs from "node:fs/promises";
import path from "node:path";

async function isDirectory(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then((st) => st.isDirectory())
    .catch(() => false);
}

/**
 * The project folders offered when starting a session: the direct subdirectories of every allowed
 * root, as absolute paths. Hidden entries and files are skipped, symlinks are followed, and a root
 * that cannot be read is ignored rather than failing the whole request. Read per request, so a
 * freshly cloned project shows up without restarting the service.
 */
export async function listProjectDirectories(roots: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(full)))) found.add(full);
    }
  }
  return [...found].sort(
    (a, b) => path.basename(a).localeCompare(path.basename(b)) || a.localeCompare(b),
  );
}
