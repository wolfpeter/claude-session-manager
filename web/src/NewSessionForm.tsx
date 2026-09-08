import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import type { ClaudeSession } from "./types";

interface Props {
  onCancel: () => void;
  onCreated: (s: ClaudeSession) => void;
  onError: (err: unknown) => void;
}

const LAST_DIR_KEY = "csm_last_dir";

export function NewSessionForm({ onCancel, onCreated, onError }: Props) {
  const [name, setName] = useState("");
  const [dir, setDir] = useState(() => localStorage.getItem(LAST_DIR_KEY) ?? "");
  const [roots, setRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    api
      .config()
      .then((c) => {
        setRoots(c.allowedDirectories);
        if (!dir && c.allowedDirectories.length === 1) setDir(c.allowedDirectories[0] + "/");
      })
      .catch(onError);
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
      const s = await api.create(name.trim(), dir.trim());
      localStorage.setItem(LAST_DIR_KEY, dir.trim());
      onCreated(s);
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : "Could not start session");
      setBusy(false);
    }
  };

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
          Working directory
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder={roots[0] ? `${roots[0]}/my-project` : "/home/you/projects/my-project"}
            required
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="url"
          />
          {roots.length > 0 && (
            <span className="hint">
              Must be inside {roots.length === 1 ? roots[0] : roots.join(" or ")}
            </span>
          )}
        </label>

        {error && <p className="notice notice-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !dir.trim()}>
            {busy ? "Starting…" : "Start Claude"}
          </button>
        </div>
      </form>
    </div>
  );
}
