import { useEffect, useState } from "react";
import { api } from "./api";

let cached: string | null = null;

/** Machine name from the backend, fetched once per page load. Also mirrored into the tab title. */
export function useHostname(): string {
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
    document.title = host ? `${host} · Claude sessions` : "Claude sessions";
  }, [host]);
  return host;
}
