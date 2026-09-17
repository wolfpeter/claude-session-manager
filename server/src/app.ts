import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { Config } from "./config.js";
import { Tmux } from "./tmux.js";
import { SessionService } from "./sessions.js";
import { attachTerminal, clampSize } from "./terminal.js";
import { isValidSessionId } from "./validate.js";
import { listExternalClaudes } from "./external.js";
import { listProjectDirectories } from "./projects.js";
import { Updater } from "./updater.js";

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // The UI polls /api/sessions every few seconds; per-request logs would drown the useful lines.
    logController: new LogController({ disableRequestLogging: true }),
  });

  const tmux = new Tmux("tmux", config.tmuxSocket);
  const sessions = new SessionService(tmux, config, app.log);
  const updater = new Updater(config.repoRoot, config.updateBranch, app.log);
  const updateSessionId = `${config.sessionPrefix}update`;

  // Optional shared-secret auth. Off when AUTH_TOKEN is empty. Applies to REST + WebSocket upgrades.
  if (config.authToken) {
    app.addHook("onRequest", async (req, reply) => {
      if (!req.url.startsWith("/api/") && !req.url.startsWith("/ws/")) return;
      const q = req.query as Record<string, unknown>;
      const given = req.headers["x-api-key"] ?? q.token;
      if (!tokenMatches(config.authToken, given)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  app.setErrorHandler((err: unknown, req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) app.log.error({ err, url: req.url }, "request failed");
    reply.code(status).send({ error: status >= 500 ? "Internal error" : e.message ?? "Bad request" });
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });

  // ---- REST -------------------------------------------------------------------------------------
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/sessions", async () => sessions.list());

  app.post<{ Body: { name?: unknown; workingDirectory?: unknown; profile?: unknown } }>("/api/sessions", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; workingDirectory?: unknown; profile?: unknown };
    const created = await sessions.create(body);
    return reply.code(201).send(created);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) => sessions.get(req.params.id));

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    await sessions.remove(req.params.id);
    return reply.code(204).send();
  });

  // Claude Code processes running in ordinary terminals (not in tmux). Shown read-only in the UI.
  app.get("/api/external", async () => listExternalClaudes(tmux));

  // ---- self-update ------------------------------------------------------------------------------
  app.get("/api/update", async () => updater.status());

  // Starts deploy.sh in a tmux session and hands back its id: the browser attaches to it and
  // watches the pull, the build, the sudo prompt and the restart of this very service.
  app.post("/api/update", async () => ({ id: await updater.start(tmux, updateSessionId) }));

  // Read fresh on every call: the new-session form fills its folder dropdown from this, and a
  // project cloned a minute ago should be in the list without restarting the service.
  app.get("/api/config", async () => ({
    hostname: os.hostname(),
    allowedDirectories: config.allowedDirectories,
    projectDirectories: await listProjectDirectories(config.allowedDirectories),
    profiles: config.claudeProfiles.map(({ id, label }) => ({ id, label })),
    sessionPrefix: config.sessionPrefix,
  }));

  // Fetching the remote periodically is what lets the list say "update available" without the
  // user asking. unref() so a pending timer never keeps the process (or a test run) alive.
  if (config.updateCheckMinutes > 0) {
    void updater.check();
    const timer = setInterval(() => void updater.check(), config.updateCheckMinutes * 60_000);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  // ---- WebSocket terminal -----------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { cols?: string; rows?: string } }>(
    "/ws/sessions/:id",
    { websocket: true },
    async (socket, req) => {
      const id = req.params.id;
      if (!isValidSessionId(id, config.sessionPrefix) || !(await sessions.exists(id))) {
        socket.send(JSON.stringify({ type: "error", message: "Session not found" }));
        socket.close(4004, "not found");
        return;
      }
      app.log.info({ id, ip: req.ip }, "terminal connected");
      socket.on("close", () => app.log.info({ id, ip: req.ip }, "terminal disconnected"));
      await tmux.ensureServerOptions();
      await attachTerminal(
        socket,
        tmux,
        id,
        {
          cols: clampSize(req.query.cols, 80),
          rows: clampSize(req.query.rows, 24),
          historyLines: config.historyLines,
          mouseReporting: config.browserMouseReporting,
        },
        app.log,
      );
    },
  );

  // ---- Frontend ---------------------------------------------------------------------------------
  if (config.webDist && fs.existsSync(path.join(config.webDist, "index.html"))) {
    // wildcard (default) serves whatever is on disk at request time, so a frontend rebuild with new
    // hashed asset names does not require a backend restart; missing files fall through to the handler below.
    await app.register(fastifyStatic, { root: config.webDist });
    // SPA fallback: any non-API GET serves index.html so /sessions/:id deep links work.
    app.setNotFoundHandler((req, reply) => {
      const isPage = !req.url.startsWith("/api/") && !req.url.startsWith("/ws/") && !req.url.startsWith("/assets/");
      if (req.method === "GET" && isPage) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  } else {
    app.log.warn({ webDist: config.webDist }, "frontend build not found; serving API only");
  }

  app.addHook("onReady", async () => {
    await tmux.ensureServerOptions();
    const found = await sessions.list();
    app.log.info({ count: found.length, ids: found.map((s) => s.id) }, "discovered tmux sessions");
  });

  return app;
}

/**
 * Turns a listen() failure into one line a person can act on. systemd only shows the exit code,
 * so an unexplained "status=1/FAILURE" is what the user is left with otherwise.
 */
export function explainListenError(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    return `port ${port} is already in use. Set PORT in .env to a free port and restart the service.`;
  }
  if (code === "EACCES") {
    return `port ${port} needs root privileges. Set PORT in .env to a port above 1024 and restart the service.`;
  }
  return err instanceof Error ? err.message : String(err);
}
