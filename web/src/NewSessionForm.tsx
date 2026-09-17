import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { folderOptions, pickRemembered, type FolderOption } from "./folders";
import type { ClaudeSession, StartProfile } from "./types";

interface Props {
  onCancel: () => void;
  onCreated: (s: ClaudeSession) => void;
  onError: (err: unknown) => void;
}

const LAST_DIR_KEY = "csm_last_dir";
const LAST_PROFILE_KEY = "csm_last_profile";

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function NewSessionForm({ onCancel, onCreated, onError }: Props) {
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [dir, setDir] = useState("");
  const [profiles, setProfiles] = useState<StartProfile[]>([]);
  const [profile, setProfile] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The folder list comes from the server (the subfolders of ALLOWED_DIRECTORIES), so a path that
  // does not exist or is not allowed cannot be typed in by accident.
  useEffect(() => {
    nameRef.current?.focus();
    api
      .config()
      .then((c) => {
        setFolders(folderOptions(c.projectDirectories));
        setDir(pickRemembered(recall(LAST_DIR_KEY), c.projectDirectories));
        setProfiles(c.profiles);
        setProfile(pickRemembered(recall(LAST_PROFILE_KEY), c.profiles.map((p) => p.id)));
        setLoading(false);
      })
      .catch((err) => {
        onError(err);
        setError(err instanceof Error ? err.message : "Could not load the project folders");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.create(name.trim(), dir, profile);
      remember(LAST_DIR_KEY, dir);
      remember(LAST_PROFILE_KEY, profile);
      onCreated(s);
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : "Could not start session");
      setBusy(false);
    }
  };

  const noFolders = !loading && folders.length === 0;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>New Claude session</h2>

        <label>
          Name
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="API refactor"
            maxLength={80}
            required
            autoComplete="off"
          />
        </label>

        <label>
          Project folder
          <select value={dir} onChange={(e) => setDir(e.target.value)} disabled={loading || noFolders} required>
            {loading && <option value="">Loading…</option>}
            {noFolders && <option value="">No project folder found</option>}
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label}
              </option>
            ))}
          </select>
          {dir && <span className="hint">{dir}</span>}
        </label>

        <label>
          Start with
          <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={loading || profiles.length === 0}>
            {loading && <option value="">Loading…</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="notice notice-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || loading || !name.trim() || !dir}>
            {busy ? "Starting…" : "Start Claude"}
          </button>
        </div>
      </form>
    </div>
  );
}
