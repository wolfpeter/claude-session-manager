import { useEffect, useState } from "react";
import { api } from "./api";

let cached: string | null = null;

/**
 * Machine name from the backend, fetched once per page load. Also mirrored into the tab title,
 * with `badge` (sessions waiting on the user) in front of it so a glance at the tab is enough.
 */
export function useHostname(badge = 0): string {
  const [host, setHost] = useState(cached ?? "");
  useEffect(() => {
    if (cached !== null) return;
    api
      .config()
      .then((c) => {
        cached = c.hostname;
        setHost(c.hostname);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const title = host ? `${host} · Claude sessions` : "Claude sessions";
    document.title = badge > 0 ? `(${badge}) ${title}` : title;
  }, [host, badge]);
  return host;
}
