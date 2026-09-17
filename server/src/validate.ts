import fs from "node:fs/promises";
import path from "node:path";

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const ID_BODY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A session id is the tmux session name: prefix + [a-z0-9_-]. Anything else is rejected. */
export function isValidSessionId(id: string, prefix: string): boolean {
  if (typeof id !== "string" || !id.startsWith(prefix)) return false;
  return ID_BODY.test(id.slice(prefix.length));
}

export function assertSessionId(id: string, prefix: string): string {
  if (!isValidSessionId(id, prefix)) throw new ValidationError("Invalid session id");
  return id;
}

/** "API refactor!" -> "api-refactor". Returns "" if nothing usable remains. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function validateName(name: unknown): string {
  if (typeof name !== "string") throw new ValidationError("name is required");
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ValidationError("name is required");
  if (trimmed.length > 80) throw new ValidationError("name is too long (max 80)");
  // tmux options are plain strings, but keep control characters out of what we later shell to terminals/logs
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) throw new ValidationError("name contains control characters");
  return trimmed;
}

/**
 * Picks the start profile the browser asked for. Missing means the first (default) profile, so an
 * older client that does not know about profiles keeps working.
 */
export function validateProfile<T extends { id: string }>(value: unknown, profiles: T[]): T {
  if (profiles.length === 0) throw new ValidationError("no start profile is configured");
  if (value === undefined || value === null || value === "") return profiles[0];
  if (typeof value !== "string") throw new ValidationError("profile must be a string");
  const found = profiles.find((p) => p.id === value);
  if (!found) throw new ValidationError(`unknown start profile "${value}"`);
  return found;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolves the directory (following symlinks) and checks that it exists, is a directory,
 * and lives inside one of the allowed roots. Returns the canonical absolute path.
 */
export async function validateWorkingDirectory(dir: unknown, allowedRoots: string[]): Promise<string> {
  if (typeof dir !== "string" || dir.trim() === "") throw new ValidationError("workingDirectory is required");
  if (!path.isAbsolute(dir)) throw new ValidationError("workingDirectory must be an absolute path");

  let real: string;
  try {
    real = await fs.realpath(dir);
  } catch {
    throw new ValidationError("workingDirectory does not exist");
  }
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new ValidationError("workingDirectory is not a directory");

  const roots = await Promise.all(allowedRoots.map((r) => fs.realpath(r).catch(() => r)));
  if (!roots.some((root) => isInside(root, real))) {
    throw new ValidationError("workingDirectory is outside ALLOWED_DIRECTORIES");
  }
  return real;
}
