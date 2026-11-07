import { apiError } from "./errors";

/**
 * Refuses requests to /api/ that another website could send while Shelf runs on this machine (b23):
 * a Host that is not the address Shelf is bound to (DNS rebinding), a write from another origin (cross-site
 * request), and a body that is not JSON (the "simple" cross-site requests that skip the browser's preflight).
 * Requests from curl and from tests send no Origin and are allowed. Checked in that order.
 */

/** The Host values Shelf answers to when it listens on `port` (127.0.0.1 only, per the PRD). */
export function allowedHosts(port: number, hostname = "127.0.0.1"): string[] {
  const names = new Set(["127.0.0.1", "localhost", hostname.toLowerCase()]);
  return [...names].map((name) => `${name}:${port}`);
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);

/**
 * Body types a route accepts besides JSON, by path. Only routes listed here may take another type; every other
 * write takes application/json alone. The import task (b17) adds "/api/import" here if it accepts text/csv.
 */
export const EXTRA_BODY_TYPES: Record<string, string[]> = {};

/** The media type of a Content-Type header, lowercased, without parameters ("application/json; charset=utf-8" -> "application/json"). */
function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/** A refusal for this request, or null when it may go on. Only paths under /api/ are checked. */
export function guardApi(req: Request, pathname: string, hosts: string[]): Response | null {
  if (!pathname.startsWith("/api/")) return null;
  const allowed = hosts.map((h) => h.toLowerCase());

  const host = req.headers.get("host");
  if (host !== null && !allowed.includes(host.toLowerCase())) {
    return apiError(
      403,
      "wrong_host",
      `Shelf does not answer requests for host "${host}".`,
      `Open Shelf at http://${hosts[0]}/ instead of another address.`,
    );
  }

  const method = req.method.toUpperCase();
  const origin = req.headers.get("origin");
  if (origin !== null && WRITE_METHODS.has(method) && !allowed.some((h) => origin.toLowerCase() === `http://${h}`)) {
    return apiError(
      403,
      "cross_origin",
      `Changes from another site (${origin}) are refused.`,
      `Make the change in Shelf itself at http://${hosts[0]}/.`,
    );
  }

  if (BODY_METHODS.has(method)) {
    const type = mediaType(req.headers.get("content-type"));
    const accepted = ["application/json", ...(EXTRA_BODY_TYPES[pathname] ?? [])];
    if (!accepted.includes(type)) {
      return apiError(
        415,
        "unsupported_media_type",
        type === "" ? "The request has no Content-Type." : `Content-Type "${type}" is not accepted here.`,
        `Send the body as ${accepted.join(" or ")} with a matching Content-Type header.`,
      );
    }
  }
  return null;
}
