import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { apiError } from "./errors";
import { exportRoute } from "./export";
import { allowedHosts, guardApi } from "./guard";
import { goalStore, goalsRoutes, parseYear } from "./goals";
import { importRoute } from "./import";
import { itemsRoutes } from "./items";
import { serveStatic } from "./static";
import { statsQueries } from "./stats";
import { tagStore } from "./tags";

export { apiError };

export type App = { fetch(req: Request): Response | Promise<Response>; db: Database };

/** The largest request body the server accepts (an import file is the only large one). */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;

export type AppOptions = {
  /** The Host values ("host:port") the API answers to; see guard.ts. Defaults to 127.0.0.1 and localhost on port 3000. */
  hosts?: string[];
};

/** Builds the Shelf app on the database at `dbPath` (":memory:" for tests), without opening a port. */
export function createApp(dbPath: string, options: AppOptions = {}): App {
  const hosts = options.hosts ?? allowedHosts(3000);
  const db = openDb(dbPath);
  const tags = tagStore(db);
  const items = itemsRoutes(db, tags);
  const stats = statsQueries(db);
  const exportItems = exportRoute(db, tags);
  const importItems = importRoute(db, tags);
  const goals = goalStore(db);
  const goalRoutes = goalsRoutes(goals);
  // GET /api/stats shows the goal for ?year=YYYY, or for the current UTC year when it is not given.
  const statsAnswer = (req: Request): Response => {
    const raw = new URL(req.url).searchParams.get("year");
    const year = raw === null ? new Date().getUTCFullYear() : parseYear(raw);
    if (year instanceof Response) return year;
    return Response.json(stats(goals.get(year)));
  };
  const fetch = async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    const refused = guardApi(req, pathname, hosts);
    if (refused) return refused;
    if (req.method === "GET" && pathname === "/api/health") return Response.json({ ok: true });
    if (req.method === "GET" && pathname === "/api/tags") return Response.json(tags.counts());
    if (req.method === "GET" && pathname === "/api/stats") return statsAnswer(req);
    if (req.method === "GET" && pathname === "/api/export") return exportItems(req);
    if (req.method === "POST" && pathname === "/api/import") return importItems(req);
    const answer = (await items(req, pathname)) ?? (await goalRoutes(req, pathname)) ?? serveStatic(req.method, pathname);
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
  // The app needs the port actually bound (PORT=0 picks one), so it is built once the server is listening.
  let app: App | undefined;
  // 20 MB is far above any real shelf export; Bun's 128 MB default would let one import use gigabytes.
  const server = Bun.serve({ hostname, port, maxRequestBodySize: MAX_BODY_BYTES, fetch: (req) => app!.fetch(req) });
  app = createApp(dbPath, { hosts: allowedHosts(server.port!, hostname) });
  console.log(`Shelf on http://${server.hostname}:${server.port} (database: ${dbPath})`);
}
