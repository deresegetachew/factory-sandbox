import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { apiError } from "./errors";
import { itemsRoutes } from "./items";

export { apiError };

export type App = { fetch(req: Request): Response | Promise<Response>; db: Database };

/** Builds the Shelf app on the database at `dbPath` (":memory:" for tests), without opening a port. */
export function createApp(dbPath: string): App {
  const db = openDb(dbPath);
  const items = itemsRoutes(db);
  const fetch = async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/api/health") return Response.json({ ok: true });
    const answer = await items(req, pathname);
    if (answer) return answer;
    return apiError(
      404,
      "not_found",
      `No route for ${req.method} ${pathname}.`,
      "Check the path and method; the API lives under /api (for example GET /api/health).",
    );
  };
  return { fetch, db };
}

/** Where the server listens and which database it opens, from the environment. Binds 127.0.0.1 unless HOST is set. */
export function serverOptions(env: Record<string, string | undefined>): {
  hostname: string;
  port: number;
  dbPath: string;
} {
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number, got "${env.PORT}"`);
  return { hostname: env.HOST || "127.0.0.1", port, dbPath: env.SHELF_DB || "shelf.db" };
}

if (import.meta.main) {
  const { hostname, port, dbPath } = serverOptions(process.env);
  const app = createApp(dbPath);
  const server = Bun.serve({ hostname, port, fetch: app.fetch });
  console.log(`Shelf on http://${server.hostname}:${server.port} (database: ${dbPath})`);
}
