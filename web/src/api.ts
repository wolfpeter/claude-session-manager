import type { AppConfig, ClaudeSession, ExternalClaude } from "./types";

const TOKEN_KEY = "csm_token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("x-api-key", token);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  list: () => request<ClaudeSession[]>("/api/sessions"),
  external: () => request<ExternalClaude[]>("/api/external"),
  get: (id: string) => request<ClaudeSession>(`/api/sessions/${encodeURIComponent(id)}`),
  create: (name: string, workingDirectory: string) =>
    request<ClaudeSession>("/api/sessions", { method: "POST", body: JSON.stringify({ name, workingDirectory }) }),
  remove: (id: string) => request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export function wsUrl(id: string, cols: number, rows: number): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
  const token = getToken();
  if (token) params.set("token", token);
  return `${proto}//${location.host}/ws/sessions/${encodeURIComponent(id)}?${params}`;
}
