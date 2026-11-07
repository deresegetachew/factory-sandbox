import type { Database } from "bun:sqlite";
import { writeCsv } from "./csv";
import { apiError } from "./errors";
import type { Item } from "./items";
import type { tagStore } from "./tags";

/** The CSV columns, in order. The import task reads the same header. */
export const CSV_COLUMNS = ["title", "author", "url", "kind", "status", "rating", "notes", "tags", "created_at", "finished_at"] as const;

/** Tags are joined with this in one CSV cell; tags themselves may not contain it (see normalizeTags). */
export const TAG_SEPARATOR = ";";

type ExportItem = Item & { tags: string[] };

/** One item as a CSV row in CSV_COLUMNS order; null becomes an empty cell. Text is written unchanged. */
export function itemToCsvRow(item: ExportItem): string[] {
  return [
    item.title,
    item.author ?? "",
    item.url ?? "",
    item.kind,
    item.status,
    item.rating == null ? "" : String(item.rating),
    item.notes,
    item.tags.join(TAG_SEPARATOR),
    item.created_at,
    item.finished_at ?? "",
  ];
}

/** GET /api/export?format=json|csv: every item, oldest first, as a download named shelf-YYYY-MM-DD.<format>. */
export function exportRoute(db: Database, tags: ReturnType<typeof tagStore>) {
  const allItems = db.query<Item, []>(
    "SELECT id, title, author, url, kind, status, rating, notes, created_at, updated_at, finished_at FROM items ORDER BY id",
  );

  return (req: Request): Response => {
    const format = new URL(req.url).searchParams.get("format");
    if (format !== "json" && format !== "csv") {
      return apiError(
        400,
        "invalid_format",
        format === null ? "format is missing." : `format "${format}" is not supported.`,
        "Use /api/export?format=json or /api/export?format=csv.",
      );
    }
    const byItem = tags.byItem();
    const items: ExportItem[] = allItems.all().map((item) => ({ ...item, tags: byItem.get(item.id) ?? [] }));
    const date = new Date().toISOString().slice(0, 10);
    const disposition = `attachment; filename="shelf-${date}.${format}"`;

    if (format === "json") {
      return new Response(JSON.stringify({ version: 1, items }, null, 2) + "\n", {
        headers: { "content-type": "application/json; charset=utf-8", "content-disposition": disposition },
      });
    }
    const csv = writeCsv([[...CSV_COLUMNS], ...items.map(itemToCsvRow)]);
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": disposition },
    });
  };
}
