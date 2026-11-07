import type { Database } from "bun:sqlite";
import { apiError } from "./errors";
import { normalizeTags, type tagStore } from "./tags";

export const KINDS = ["book", "article"] as const;
export const STATUSES = ["to_read", "reading", "done"] as const;

export type Item = {
  id: number;
  title: string;
  author: string | null;
  url: string | null;
  kind: (typeof KINDS)[number];
  status: (typeof STATUSES)[number];
  rating: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

/** The fields a person may set. Every key is optional here; `validateItemInput` checks what is required. */
type ItemInput = Partial<Pick<Item, "title" | "author" | "url" | "kind" | "status" | "rating" | "notes" | "finished_at">>;

/** A checked request body: the item's columns to set, and its new tags when the body had `tags`. */
type CheckedInput = { fields: ItemInput; tags?: string[] };

const COLUMNS = "id, title, author, url, kind, status, rating, notes, created_at, updated_at, finished_at";

class InputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fix: string,
  ) {
    super(message);
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Parses an ISO 8601 date or date-time into a UTC ISO string, or null when it is not a real date. */
export function parseIsoDate(value: string): string | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  // Date-only and local times are read as UTC; reject times without a zone being guessed differently by the engine.
  const text = h === undefined ? `${y}-${mo}-${d}T00:00:00Z` : zone === undefined ? `${value}Z` : value;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  // Catch dates the engine rolls over (2024-02-30 -> 2024-03-01) by checking the fields it was given.
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1) return null;
  const daysInMonth = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
  if (Number(d) > daysInMonth) return null;
  if (h !== undefined && (Number(h) > 23 || Number(mi) > 59 || (s !== undefined && Number(s) > 59))) return null;
  return date.toISOString();
}

function optionalText(body: Record<string, unknown>, key: "author" | "url"): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new InputError(`invalid_${key}`, `${key} must be a string or null.`, `Send ${key} as text, or null to leave it empty.`);
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Checks a POST (`creating`) or PATCH body and returns only the fields it sets, cleaned (title trimmed, dates in UTC).
 * Unknown keys are ignored. Throws an InputError naming the first bad field.
 */
function validateItemInput(body: unknown, creating: boolean): CheckedInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InputError("invalid_body", "The request body must be a JSON object.", 'Send an object such as {"title": "Dune"}.');
  }
  const b = body as Record<string, unknown>;
  const out: ItemInput = {};

  if (b.title !== undefined || creating) {
    if (typeof b.title !== "string" || b.title.trim() === "") {
      throw new InputError("invalid_title", "title is required and cannot be blank.", 'Give the item a title, for example {"title": "Dune"}.');
    }
    out.title = b.title.trim();
  }

  const author = optionalText(b, "author");
  if (author !== undefined) out.author = author;

  const url = optionalText(b, "url");
  if (url !== undefined) {
    if (url !== null) {
      let ok = false;
      try {
        const p = new URL(url).protocol;
        ok = p === "http:" || p === "https:";
      } catch {}
      if (!ok) throw new InputError("invalid_url", `url "${url}" is not an http or https address.`, "Use a link starting with http:// or https://, or leave url out.");
    }
    out.url = url;
  }

  if (b.kind !== undefined) {
    if (!KINDS.includes(b.kind as Item["kind"])) {
      throw new InputError("invalid_kind", `kind must be one of ${KINDS.join(", ")}.`, `Set kind to "book" or "article".`);
    }
    out.kind = b.kind as Item["kind"];
  }

  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status as Item["status"])) {
      throw new InputError("invalid_status", `status must be one of ${STATUSES.join(", ")}.`, `Set status to "to_read", "reading" or "done".`);
    }
    out.status = b.status as Item["status"];
  }

  if (b.rating !== undefined) {
    const r = b.rating;
    if (r !== null && !(typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 5)) {
      throw new InputError("invalid_rating", "rating must be a whole number from 1 to 5, or null.", "Send a rating of 1, 2, 3, 4 or 5, or null for no rating.");
    }
    out.rating = r as number | null;
  }

  if (b.notes !== undefined) {
    if (typeof b.notes !== "string") throw new InputError("invalid_notes", "notes must be text.", 'Send notes as a string ("" for none).');
    out.notes = b.notes;
  }

  if (b.finished_at !== undefined) {
    if (b.finished_at === null) out.finished_at = null;
    else {
      const parsed = typeof b.finished_at === "string" ? parseIsoDate(b.finished_at) : null;
      if (parsed === null) {
        throw new InputError("invalid_finished_at", "finished_at must be a valid ISO 8601 date.", 'Use a date like "2024-03-15" or "2024-03-15T18:30:00Z", or leave it out.');
      }
      out.finished_at = parsed;
    }
  }

  if (b.tags === undefined) return { fields: out };
  const tags = normalizeTags(b.tags);
  if (!Array.isArray(tags)) throw new InputError(tags.code, tags.message, tags.fix);
  return { fields: out, tags };
}

/** The item's new finished_at: a given value wins; otherwise set on entering done, cleared on leaving it. */
function nextFinishedAt(input: ItemInput, before: Pick<Item, "status" | "finished_at"> | null, now: string): string | null {
  const status = input.status ?? before?.status ?? "to_read";
  if (input.finished_at !== undefined) return input.finished_at;
  if (status !== "done") return null;
  return before?.status === "done" ? before.finished_at : now;
}

function notFound(id: string): Response {
  return apiError(404, "item_not_found", `No item with id ${id}.`, "List the items with GET /api/items to find the right id.");
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new InputError("invalid_json", "The request body is not valid JSON.", "Send a JSON object with Content-Type: application/json.");
  }
}

/** The /api/items routes on `db`. Returns null when the path is not an items route, so the caller can answer 404. */
export function itemsRoutes(db: Database, tags: ReturnType<typeof tagStore>) {
  const getItem = db.query<Item, [number]>(`SELECT ${COLUMNS} FROM items WHERE id = ?`);
  const listItems = db.query<Item, []>(`SELECT ${COLUMNS} FROM items ORDER BY created_at DESC, id DESC`);
  const insertItem = db.query<Item, Record<string, string | number | null>>(
    `INSERT INTO items (title, author, url, kind, status, rating, notes, created_at, updated_at, finished_at)
     VALUES ($title, $author, $url, $kind, $status, $rating, $notes, $now, $now, $finished_at)
     RETURNING ${COLUMNS}`,
  );
  const deleteItem = db.query<{ id: number }, [number]>("DELETE FROM items WHERE id = ? RETURNING id");

  const withTags = (item: Item) => ({ ...item, tags: tags.of(item.id) });

  // The item row and its tags are written in one transaction, so a failure leaves neither half behind.
  const insert = db.transaction((input: CheckedInput, now: string): Item => {
    const f = input.fields;
    const item = insertItem.get({
      $title: f.title!,
      $author: f.author ?? null,
      $url: f.url ?? null,
      $kind: f.kind ?? "book",
      $status: f.status ?? "to_read",
      $rating: f.rating ?? null,
      $notes: f.notes ?? "",
      $now: now,
      $finished_at: nextFinishedAt(f, null, now),
    })!;
    tags.replace(item.id, input.tags ?? []);
    return item;
  });

  const patch = db.transaction((id: number, before: Item, input: CheckedInput, now: string): Item => {
    const fields: Record<string, string | number | null> = {
      ...input.fields,
      updated_at: now,
      finished_at: nextFinishedAt(input.fields, before, now),
    };
    // Column names come from the fixed set validateItemInput produces, never from the request; the values are bound.
    const sets = Object.keys(fields).map((k) => `${k} = $${k}`);
    const params = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`$${k}`, v ?? null]));
    const item = db
      .query<Item, Record<string, string | number | null>>(`UPDATE items SET ${sets.join(", ")} WHERE id = $id RETURNING ${COLUMNS}`)
      .get({ ...params, $id: id })!;
    if (input.tags !== undefined) tags.replace(id, input.tags);
    return item;
  });

  const create = async (req: Request): Promise<Response> => {
    const input = validateItemInput(await readJson(req), true);
    return Response.json(withTags(insert(input, new Date().toISOString())), { status: 201 });
  };

  const update = async (req: Request, id: number, rawId: string): Promise<Response> => {
    const before = getItem.get(id);
    if (!before) return notFound(rawId);
    const input = validateItemInput(await readJson(req), false);
    return Response.json(withTags(patch(id, before, input, new Date().toISOString())));
  };

  const list = (): Response => {
    const byItem = tags.byItem();
    return Response.json(listItems.all().map((item) => ({ ...item, tags: byItem.get(item.id) ?? [] })));
  };

  return async (req: Request, pathname: string): Promise<Response | null> => {
    try {
      if (pathname === "/api/items") {
        if (req.method === "GET") return list();
        if (req.method === "POST") return await create(req);
        return null;
      }
      const m = /^\/api\/items\/([^/]+)$/.exec(pathname);
      if (!m) return null;
      if (!["GET", "PATCH", "DELETE"].includes(req.method)) return null;
      const rawId = m[1]!;
      const id = /^[1-9]\d{0,14}$/.test(rawId) ? Number(rawId) : NaN;
      if (Number.isNaN(id)) return notFound(rawId);
      if (req.method === "GET") {
        const item = getItem.get(id);
        return item ? Response.json(withTags(item)) : notFound(rawId);
      }
      // The tags table cascades on delete (foreign_keys is on), so the item's tags go with it.
      if (req.method === "DELETE") return deleteItem.get(id) ? new Response(null, { status: 204 }) : notFound(rawId);
      return await update(req, id, rawId);
    } catch (e) {
      if (e instanceof InputError) return apiError(400, e.code, e.message, e.fix);
      throw e;
    }
  };
}
