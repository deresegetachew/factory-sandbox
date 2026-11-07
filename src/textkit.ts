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

/**
 * Counts the words in text: the runs of non-whitespace characters, so
 * leading, trailing and repeated whitespace never adds a word.
 */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}
