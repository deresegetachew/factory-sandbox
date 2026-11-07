import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "public");

/**
 * The web UI's files: URL path -> file in src/shelf/public and its content type. Only these are served, so no
 * request path ever reaches the file system.
 */
const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/render.js": { file: "render.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

/** Answers GET for one of the UI's files, or null when `pathname` is not one of them. */
export function serveStatic(method: string, pathname: string): Response | null {
  if (method !== "GET") return null;
  const entry = FILES[pathname];
  if (!entry) return null;
  return new Response(Bun.file(join(PUBLIC_DIR, entry.file)), {
    headers: { "content-type": entry.type, "cache-control": "no-cache" },
  });
}
