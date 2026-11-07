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

/** The Markdown groups, in the order the file lists them. */
const MD_GROUPS: Array<[Item["status"], string]> = [
  ["reading", "Reading"],
  ["to_read", "To read"],
  ["done", "Done"],
];

/**
 * Text a user typed, made safe to put on one Markdown list line: line breaks become spaces, and a backslash goes
 * before the characters that would start formatting, a link, a heading, HTML or a table cell, and before a leading
 * list or heading marker (-, +, =, or the . or ) after a leading number).
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/[\\`*_[\]()#<>|!~&]/g, "\\$&")
    .replace(/^[-+=]/, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/** A URL as a Markdown link target: the characters that would end or split it are percent-encoded. */
function markdownUrl(url: string): string {
  return url.replace(/[ ()<>]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** One item as a list line: title (a link when it has a URL), author, rating as stars, tags. Notes are left out. */
function itemToMarkdownLine(item: ExportItem): string {
  const title = escapeMarkdown(item.title);
  let line = "- " + (item.url ? `[${title}](${markdownUrl(item.url)})` : title);
  if (item.author) line += ` by ${escapeMarkdown(item.author)}`;
  if (item.rating != null) line += ` · ${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}`;
  if (item.tags.length > 0) line += ` · tags: ${item.tags.map(escapeMarkdown).join(", ")}`;
  return line + "\n";
}

/** The whole shelf as Markdown: a heading, then one heading per non-empty status group, items oldest (by id) first. */
export function toMarkdown(items: ExportItem[]): string {
  if (items.length === 0) return "# Shelf\n\nYour shelf is empty.\n";
  const sorted = [...items].sort((a, b) => a.id - b.id);
  let md = "# Shelf\n";
  for (const [status, heading] of MD_GROUPS) {
    const group = sorted.filter((item) => item.status === status);
    if (group.length > 0) md += `\n## ${heading}\n\n` + group.map(itemToMarkdownLine).join("");
  }
  return md;
}

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

/** GET /api/export?format=json|csv|md: every item, oldest first, as a download named shelf-YYYY-MM-DD.<format>. */
export function exportRoute(db: Database, tags: ReturnType<typeof tagStore>) {
  const allItems = db.query<Item, []>(
    "SELECT id, title, author, url, kind, status, rating, notes, created_at, updated_at, finished_at FROM items ORDER BY id",
  );

  return (req: Request): Response => {
    const format = new URL(req.url).searchParams.get("format");
    if (format !== "json" && format !== "csv" && format !== "md") {
      return apiError(
        400,
        "invalid_format",
        format === null ? "format is missing." : `format "${format}" is not supported.`,
        "Use /api/export?format=json, /api/export?format=csv or /api/export?format=md.",
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
    if (format === "md") {
      return new Response(toMarkdown(items), {
        headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": disposition },
      });
    }
    const csv = writeCsv([[...CSV_COLUMNS], ...items.map(itemToCsvRow)]);
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": disposition },
    });
  };
}
