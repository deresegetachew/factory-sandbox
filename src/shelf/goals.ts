import type { Database } from "bun:sqlite";
import { apiError } from "./errors";

/** A year's reading goal as the API answers it: the target and how many count toward it so far. */
export type Goal = { year: number; books: number; done: number };

export const MIN_GOAL_BOOKS = 1;
export const MAX_GOAL_BOOKS = 1000;

/**
 * Which done items count toward a goal. Only books for now (PRD open question Q4); if the owner decides articles count
 * too, this one condition is the change.
 */
const COUNTS_TOWARD_GOAL = "kind = 'book'";

const YEAR = /^\d{4}$/;

/** A four-digit year from the path or query, or a 400 answer saying how to fix it. */
export function parseYear(raw: string): number | Response {
  if (YEAR.test(raw)) return Number(raw);
  return apiError(400, "invalid_year", "The year must be four digits.", "Use a year such as 2026, for example /api/goals/2026 or ?year=2026.");
}

/** The goal store on `db`: read a year's goal with its progress, set it, remove it. */
export function goalStore(db: Database) {
  const getBooks = db.query<{ books: number }, [number]>("SELECT books FROM goals WHERE year = ?");
  // finished_at is a UTC ISO string, so its first four characters are the UTC year (as byMonth uses the first seven).
  const countDone = db.query<{ n: number }, [string]>(
    `SELECT COUNT(*) AS n FROM items
      WHERE status = 'done' AND finished_at IS NOT NULL AND substr(finished_at, 1, 4) = ? AND ${COUNTS_TOWARD_GOAL}`,
  );
  const upsert = db.query<null, [number, number]>(
    "INSERT INTO goals (year, books) VALUES (?, ?) ON CONFLICT (year) DO UPDATE SET books = excluded.books",
  );
  const remove = db.query<{ year: number }, [number]>("DELETE FROM goals WHERE year = ? RETURNING year");

  /** The goal for `year` with its progress, or null when none is set. */
  const get = (year: number): Goal | null => {
    const row = getBooks.get(year);
    if (!row) return null;
    return { year, books: row.books, done: countDone.get(String(year).padStart(4, "0"))!.n };
  };

  return {
    get,
    set(year: number, books: number): Goal {
      upsert.run(year, books);
      return get(year)!;
    },
    /** Removes the year's goal; false when there was none. */
    remove(year: number): boolean {
      return remove.get(year) !== null;
    },
  };
}

function invalidBooks(message: string): Response {
  return apiError(
    400,
    "invalid_books",
    message,
    `Send {"books": n} with a whole number from ${MIN_GOAL_BOOKS} to ${MAX_GOAL_BOOKS}, such as {"books": 24}.`,
  );
}

/** Checks a PUT body and returns the number of books, or a 400 answer. */
async function readBooks(req: Request): Promise<number | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid JSON.", 'Send a JSON object such as {"books": 24}.');
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError(400, "invalid_body", "The request body must be a JSON object.", 'Send an object such as {"books": 24}.');
  }
  const books = (body as Record<string, unknown>).books;
  if (books === undefined) return invalidBooks("books is required.");
  if (typeof books !== "number" || !Number.isInteger(books)) return invalidBooks("books must be a whole number.");
  if (books < MIN_GOAL_BOOKS || books > MAX_GOAL_BOOKS) {
    return invalidBooks(`books must be from ${MIN_GOAL_BOOKS} to ${MAX_GOAL_BOOKS}, got ${books}.`);
  }
  return books;
}

/** The /api/goals/:year routes. Returns null when the request is not one, so the caller can answer 404. */
export function goalsRoutes(goals: ReturnType<typeof goalStore>) {
  return async (req: Request, pathname: string): Promise<Response | null> => {
    const m = /^\/api\/goals\/([^/]*)$/.exec(pathname);
    if (!m || (req.method !== "PUT" && req.method !== "DELETE")) return null;
    const year = parseYear(m[1]!);
    if (year instanceof Response) return year;
    if (req.method === "DELETE") {
      if (goals.remove(year)) return new Response(null, { status: 204 });
      return apiError(404, "goal_not_found", `No goal is set for ${year}.`, `Set one with PUT /api/goals/${year} and {"books": n}.`);
    }
    const books = await readBooks(req);
    if (books instanceof Response) return books;
    return Response.json(goals.set(year, books));
  };
}
