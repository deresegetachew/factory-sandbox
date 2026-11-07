import type { Database } from "bun:sqlite";
import { csvRecords } from "./csv";
import { apiError } from "./errors";
import { TAG_SEPARATOR } from "./export";
import { type CheckedInput, InputError, type Item, nextFinishedAt, parseIsoDate, validateItemInput } from "./items";
import type { tagStore } from "./tags";

/** One row the import did not add, with its 1-based data row number and why. */
type RowNote = { row: number; reason: string };

export type ImportResult = { added: number; skipped: RowNote[]; rejected: RowNote[] };

/**
 * A data row read from the file: its number, the item body to validate, and the dates the file gave. `error` is set
 * when the row cannot be an item at all (so it is rejected with that reason, never dropped).
 */
type FileRow = { row: number; body: unknown; created_at?: unknown; updated_at?: unknown; error?: string };

/** Far above any real shelf; a larger file answers 400 instead of tying up the single-process server. */
export const MAX_IMPORT_ROWS = 100_000;
/** The export has 10 columns; a much wider header is not a Shelf file and would make every row slow to read. */
export const MAX_CSV_COLUMNS = 200;

/** A whole-file problem: the import answers 400 and adds nothing. */
class FileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fix: string,
  ) {
    super(message);
  }
}

function checkRowCount(count: number): void {
  if (count > MAX_IMPORT_ROWS) {
    throw new FileError(
      "too_many_rows",
      `The file has ${count} rows; an import takes at most ${MAX_IMPORT_ROWS}.`,
      "Split the file into smaller files and import them one after another.",
    );
  }
}

/** The duplicate key from Q1: the URL, or with no URL the title and author; all compared case-insensitively. */
function duplicateKey(item: { title: string; author: string | null; url: string | null }): string {
  if (item.url) return `url:${item.url.toLowerCase()}`;
  return `title:${item.title.trim().toLowerCase()}\u0000${(item.author ?? "").toLowerCase()}`;
}

/** The rows of an export-format JSON file: {version: 1, items: [...]}. */
function rowsFromJson(text: string): FileRow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FileError("invalid_json", "The file is not valid JSON.", "Import a file made by Shelf's JSON export, or fix the JSON and try again.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data) || !Array.isArray((data as { items?: unknown }).items)) {
    throw new FileError("invalid_file", 'The JSON file has no "items" list.', 'Import a file made by Shelf\'s JSON export: {"version": 1, "items": [...]}.');
  }
  const { version, items } = data as { version?: unknown; items: unknown[] };
  if (version !== undefined && version !== 1) {
    throw new FileError("unsupported_version", `The file's version ${JSON.stringify(version)} is not supported.`, "Import a file made by this version of Shelf (version 1).");
  }
  checkRowCount(items.length);
  return items.map((item, i): FileRow => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { row: i + 1, body: item, error: "The item is not an object." };
    }
    const body = item as Record<string, unknown>;
    return { row: i + 1, body, created_at: body.created_at, updated_at: body.updated_at };
  });
}

/**
 * The header and the data records of a CSV file, with a leading BOM stripped. Only truly empty lines are skipped,
 * and never kept; a line with an empty or blank cell is a record and gets validated. Reading stops with
 * too_many_rows as soon as data record maxRows + 1 is read, so the rest of the file is never parsed.
 */
export function readCsvLines(text: string, maxRows: number = MAX_IMPORT_ROWS): string[][] {
  const lines: string[][] = [];
  try {
    for (const cells of csvRecords(text.startsWith("﻿") ? text.slice(1) : text)) {
      if (cells.length === 0) continue;
      lines.push(cells);
      // lines holds the header too, so more than maxRows data records means more than maxRows + 1 lines.
      if (lines.length > maxRows + 1) {
        throw new FileError(
          "too_many_rows",
          `The file has more than ${maxRows} rows; an import takes at most ${maxRows}.`,
          "Split the file into smaller files and import them one after another.",
        );
      }
    }
  } catch (e) {
    if (e instanceof FileError) throw e;
    throw new FileError("invalid_csv", (e as Error).message, "Fix the CSV (or export it again from Shelf) and import it again.");
  }
  return lines;
}

/** The rows of an export-format CSV file, read by header name; unknown columns are ignored. */
function rowsFromCsv(text: string): FileRow[] {
  const lines = readCsvLines(text);
  const header = lines.shift();
  if (!header) throw new FileError("invalid_csv", "The CSV file is empty.", "Import a CSV with a header row: title,author,url,...");
  if (header.length > MAX_CSV_COLUMNS) {
    throw new FileError(
      "invalid_csv",
      `The CSV header has ${header.length} columns; Shelf reads at most ${MAX_CSV_COLUMNS}.`,
      "Import a file made by Shelf's CSV export, or remove the extra columns.",
    );
  }

  // Each column's position, found once from the header.
  const position = new Map<string, number>();
  header.forEach((name, at) => {
    const key = name.trim().toLowerCase();
    if (!position.has(key)) position.set(key, at);
  });
  if (!position.has("title")) {
    throw new FileError("missing_column", 'The CSV has no "title" column.', "Add a title column to the header row, or export the file again from Shelf.");
  }

  return lines.map((cells, i): FileRow => {
    const row = i + 1;
    if (cells.length > header.length) {
      return { row, body: null, error: "The row has more cells than the header. Check for an unquoted comma in a cell." };
    }
    const cell = (name: string): string | undefined => {
      const at = position.get(name);
      return at === undefined ? undefined : (cells[at] ?? "");
    };
    const body: Record<string, unknown> = { title: cell("title") ?? "" };
    for (const name of ["author", "url", "finished_at"]) {
      const v = cell(name);
      if (v !== undefined) body[name] = v === "" ? null : v;
    }
    for (const name of ["kind", "status"]) {
      const v = cell(name);
      if (v !== undefined && v !== "") body[name] = v;
    }
    const rating = cell("rating");
    if (rating !== undefined) body.rating = rating === "" ? null : /^\d+$/.test(rating.trim()) ? Number(rating.trim()) : rating;
    const notes = cell("notes");
    if (notes !== undefined) body.notes = notes;
    const tags = cell("tags");
    if (tags !== undefined) body.tags = tags.split(TAG_SEPARATOR).map((t) => t.trim()).filter((t) => t !== "");
    const created = cell("created_at");
    return { row, body, created_at: created === "" ? undefined : created };
  });
}

/** A date from the file kept as UTC ISO, the fallback when absent, or an InputError when present but not a date. */
function fileDate(value: unknown, name: string, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "string" ? parseIsoDate(value) : null;
  if (parsed === null) {
    throw new InputError(`invalid_${name}`, `${name} must be a valid ISO 8601 date.`, `Use a date like "2024-03-15T18:30:00Z", or leave ${name} empty.`);
  }
  return parsed;
}

/**
 * POST /api/import?format=json|csv. Adds the valid rows in file order, in one transaction; never changes or deletes
 * an existing item. Duplicates (Q1) go to skipped, invalid rows to rejected; a broken file answers 400 and adds nothing.
 */
export function importRoute(db: Database, tags: ReturnType<typeof tagStore>) {
  const existing = db.query<Pick<Item, "title" | "author" | "url">, []>("SELECT title, author, url FROM items");
  const insertItem = db.query<{ id: number }, Record<string, string | number | null>>(
    `INSERT INTO items (title, author, url, kind, status, rating, notes, created_at, updated_at, finished_at)
     VALUES ($title, $author, $url, $kind, $status, $rating, $notes, $created_at, $updated_at, $finished_at)
     RETURNING id`,
  );

  const run = db.transaction((rows: FileRow[], now: string): ImportResult => {
    const result: ImportResult = { added: 0, skipped: [], rejected: [] };
    const seen = new Map<string, number | "shelf">();
    for (const item of existing.all()) seen.set(duplicateKey(item), "shelf");

    for (const { row, body, created_at, updated_at, error } of rows) {
      if (error !== undefined) {
        result.rejected.push({ row, reason: error });
        continue;
      }
      let input: CheckedInput;
      let created: string;
      let updated: string;
      try {
        input = validateItemInput(body, true);
        created = fileDate(created_at, "created_at", now);
        // updated_at is bookkeeping, not something the person typed: a bad one falls back to now instead of
        // rejecting the row.
        updated = (typeof updated_at === "string" && parseIsoDate(updated_at)) || now;
      } catch (e) {
        if (!(e instanceof InputError)) throw e;
        result.rejected.push({ row, reason: `${e.message} ${e.fix}` });
        continue;
      }
      const f = input.fields;
      const key = duplicateKey({ title: f.title!, author: f.author ?? null, url: f.url ?? null });
      const match = seen.get(key);
      if (match !== undefined) {
        result.skipped.push({
          row,
          reason: match === "shelf" ? "Duplicate: this item is already on the shelf." : `Duplicate of row ${match} in this file.`,
        });
        continue;
      }
      const { id } = insertItem.get({
        $title: f.title!,
        $author: f.author ?? null,
        $url: f.url ?? null,
        $kind: f.kind ?? "book",
        $status: f.status ?? "to_read",
        $rating: f.rating ?? null,
        $notes: f.notes ?? "",
        $created_at: created,
        $updated_at: updated,
        $finished_at: nextFinishedAt(f, null, now),
      })!;
      tags.replace(id, input.tags ?? []);
      seen.set(key, row);
      result.added++;
    }
    return result;
  });

  return async (req: Request): Promise<Response> => {
    const format = new URL(req.url).searchParams.get("format");
    if (format !== "json" && format !== "csv") {
      return apiError(
        400,
        "invalid_format",
        format === null ? "format is missing." : `format "${format}" is not supported.`,
        "Use /api/import?format=json or /api/import?format=csv, matching the file.",
      );
    }
    try {
      const text = await req.text();
      const rows = format === "json" ? rowsFromJson(text) : rowsFromCsv(text);
      return Response.json(run(rows, new Date().toISOString()));
    } catch (e) {
      if (e instanceof FileError) return apiError(400, e.code, e.message, e.fix);
      throw e;
    }
  };
}
