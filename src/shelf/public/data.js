// Stats, import and export helpers for the page. Pure: no DOM, so Bun tests them.

/** The server refuses bodies over this (server.ts MAX_BODY_BYTES); the page checks first so nothing big is sent. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * GET /api/stats as table rows: months [month, done] (newest first, as the API sends them), tags [tag, total, done],
 * totals per status, and whether nothing is finished yet. Numbers become text so the page sets them as text.
 */
export function statsTables(stats) {
  return {
    months: stats.byMonth.map(({ month, done }) => [month, String(done)]),
    tags: stats.byTag.map(({ tag, total, done }) => [tag, String(total), String(done)]),
    totals: [
      ["To read", String(stats.totals.to_read)],
      ["Reading", String(stats.totals.reading)],
      ["Done", String(stats.totals.done)],
    ],
    nothingFinished: stats.byMonth.length === 0,
  };
}

/** The import format for a file name: "json" or "csv" by its extension (any case), else null. */
export function importFormat(fileName) {
  const match = /\.(json|csv)$/i.exec(String(fileName));
  return match ? match[1].toLowerCase() : null;
}

/** The Content-Type the import is sent with. */
export function importContentType(format) {
  return format === "csv" ? "text/csv" : "application/json";
}

/** Why a chosen file cannot be imported (shown to the person, nothing is sent), or null when it can be sent. */
export function importProblem(file) {
  if (!importFormat(file.name)) return "Choose a .json or .csv file exported from Shelf.";
  if (file.size === 0) return "The file is empty. Choose a .json or .csv file exported from Shelf.";
  if (file.size > MAX_IMPORT_BYTES) return "The file is larger than 20 MB. Split it into smaller files and import them one after another.";
  return null;
}

/** The import answer as a headline and every skipped and rejected row, by row number (rejected first on a tie). */
export function importSummary(result) {
  const rows = [
    ...result.rejected.map(({ row, reason }) => ({ kind: "rejected", row, reason })),
    ...result.skipped.map(({ row, reason }) => ({ kind: "skipped", row, reason })),
  ].sort((a, b) => a.row - b.row || (a.kind === b.kind ? 0 : a.kind === "rejected" ? -1 : 1));
  return {
    headline: `Added ${result.added}, skipped ${result.skipped.length}, rejected ${result.rejected.length}`,
    rows,
  };
}

/** Where the export buttons download from; the server names the file shelf-YYYY-MM-DD.<format>. */
export function exportPath(format) {
  return `/api/export?format=${format}`;
}
