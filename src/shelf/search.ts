import { KINDS, STATUSES } from "./fields";

/** Why the query string was refused: an error code, a message and a fix, for the API's 400 answer. */
export type QueryProblem = { code: string; message: string; fix: string };

/** The search and filters on GET /api/items. Each field is absent when that filter is not set. */
export type ItemQuery = {
  q?: string;
  status?: string;
  kind?: string;
  tag?: string;
  minRating?: number;
};

/** What `matchesQuery` needs from an item. */
type Searchable = {
  title: string;
  author: string | null;
  notes: string;
  status: string;
  kind: string;
  rating: number | null;
  tags: string[];
};

const allowed = (list: readonly string[], value: string) => list.includes(value);

/**
 * Reads the query string of GET /api/items. Parameters given empty (or q of only spaces) mean no filter; unknown
 * parameters are ignored. Returns a problem for the API's 400 answer when status, kind or min_rating is not allowed.
 */
export function parseItemQuery(params: URLSearchParams): ItemQuery | QueryProblem {
  const get = (name: string) => {
    const v = params.get(name);
    return v === null || v.trim() === "" ? undefined : v.trim();
  };
  const query: ItemQuery = {};

  const q = get("q");
  if (q !== undefined) query.q = q.toLowerCase();

  const status = get("status");
  if (status !== undefined) {
    if (!allowed(STATUSES, status)) {
      return { code: "invalid_status", message: `status must be one of ${STATUSES.join(", ")}.`, fix: "Use status=to_read, status=reading or status=done, or leave it out." };
    }
    query.status = status;
  }

  const kind = get("kind");
  if (kind !== undefined) {
    if (!allowed(KINDS, kind)) {
      return { code: "invalid_kind", message: `kind must be one of ${KINDS.join(", ")}.`, fix: "Use kind=book or kind=article, or leave it out." };
    }
    query.kind = kind;
  }

  const tag = get("tag");
  if (tag !== undefined) query.tag = tag.toLowerCase();

  const minRating = get("min_rating");
  if (minRating !== undefined) {
    if (!/^[1-5]$/.test(minRating)) {
      return { code: "invalid_min_rating", message: "min_rating must be a whole number from 1 to 5.", fix: "Use min_rating=1 to min_rating=5, or leave it out." };
    }
    query.minRating = Number(minRating);
  }
  return query;
}

/**
 * True when the item passes every filter in `query` (AND). q is a literal, case-insensitive substring match on the
 * title, author, notes and tags; it is matched in JavaScript, so no SQL LIKE wildcards apply and non-Latin case folds.
 */
export function matchesQuery(item: Searchable, query: ItemQuery): boolean {
  if (query.status !== undefined && item.status !== query.status) return false;
  if (query.kind !== undefined && item.kind !== query.kind) return false;
  if (query.tag !== undefined && !item.tags.includes(query.tag)) return false;
  if (query.minRating !== undefined && (item.rating === null || item.rating < query.minRating)) return false;
  if (query.q !== undefined) {
    const q = query.q;
    const fields = [item.title, item.author ?? "", item.notes, ...item.tags];
    if (!fields.some((f) => f.toLowerCase().includes(q))) return false;
  }
  return true;
}
