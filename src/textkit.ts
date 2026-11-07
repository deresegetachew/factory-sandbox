/**
 * Turns text into a URL slug: lowercased and trimmed, each run of characters
 * that are not letters or digits becomes one dash, with no dash at either end.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
