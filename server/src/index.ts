import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down (tmux sessions keep running)");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
