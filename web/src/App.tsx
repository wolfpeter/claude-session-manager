import { useCallback, useEffect, useState } from "react";
import { SessionList } from "./SessionList";
import { TerminalView } from "./TerminalView";
import { ApiError, setToken } from "./api";

type Route = { page: "list" } | { page: "session"; id: string };

function parseRoute(pathname: string): Route {
  const m = pathname.match(/^\/sessions\/([^/]+)\/?$/);
  return m ? { page: "session", id: decodeURIComponent(m[1]) } : { page: "list" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    history.pushState(null, "", path);
    setRoute(parseRoute(path));
  }, []);

  // Minimal auth UX: a 401 asks for the token once and stores it. Off unless AUTH_TOKEN is configured on the server.
  const [authNonce, setAuthNonce] = useState(0);
  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      const t = window.prompt("This server requires an access token:");
      if (t) {
        setToken(t.trim());
        setAuthNonce((n) => n + 1);
      }
    }
  }, []);

  if (route.page === "session") {
    return (
      <TerminalView
        key={`${route.id}:${authNonce}`}
        id={route.id}
        onBack={() => navigate("/")}
        onOpen={(id) => navigate(`/sessions/${encodeURIComponent(id)}`)}
        onError={handleError}
      />
    );
  }
  return <SessionList key={authNonce} onOpen={(id) => navigate(`/sessions/${encodeURIComponent(id)}`)} onError={handleError} />;
}
