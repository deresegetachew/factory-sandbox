import type { Database } from "bun:sqlite";

/** Why a `tags` value was refused: an error code, a message and a fix, for the API's 400 answer. */
export type TagProblem = { code: string; message: string; fix: string };

/**
 * Cleans a `tags` value from a request: each tag trimmed and lowercased, duplicates collapsed, sorted.
 * Returns a TagProblem when it is not an array of strings, or a tag is blank or contains ";" or ","
 * (the CSV export joins tags with ";").
 */
export function normalizeTags(value: unknown): string[] | TagProblem {
  const fix = 'Send tags as a list of words, for example ["sci-fi", "history"], with no blank tags and no ";" or ",".';
  if (!Array.isArray(value)) return { code: "invalid_tags", message: "tags must be a list of strings.", fix };
  const tags = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return { code: "invalid_tags", message: "Every tag must be a string.", fix };
    const tag = raw.trim().toLowerCase();
    if (tag === "") return { code: "invalid_tags", message: "A tag cannot be blank.", fix };
    if (tag.includes(";") || tag.includes(",")) {
      return { code: "invalid_tags", message: `The tag "${tag}" contains ";" or ",".`, fix };
    }
    tags.add(tag);
  }
  return [...tags].sort();
}

/** Reads and replaces item tags on `db`. Tags are always returned sorted. */
export function tagStore(db: Database) {
  const forItem = db.query<{ tag: string }, [number]>("SELECT tag FROM tags WHERE item_id = ?");
  const all = db.query<{ item_id: number; tag: string }, []>("SELECT item_id, tag FROM tags");
  const clear = db.query<unknown, [number]>("DELETE FROM tags WHERE item_id = ?");
  const add = db.query<unknown, [number, string]>("INSERT INTO tags (item_id, tag) VALUES (?, ?)");
  const counts = db.query<{ tag: string; count: number }, []>("SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag");

  return {
    /** The item's tags, sorted. */
    of(itemId: number): string[] {
      return forItem.all(itemId).map((r) => r.tag).sort();
    },
    /** Every item's tags, sorted, by item id (items with no tags are absent). */
    byItem(): Map<number, string[]> {
      const map = new Map<number, string[]>();
      for (const { item_id, tag } of all.all()) {
        const list = map.get(item_id);
        if (list) list.push(tag);
        else map.set(item_id, [tag]);
      }
      for (const list of map.values()) list.sort();
      return map;
    },
    /** Replaces the item's tags with `tags` (already normalized). Call inside the item's transaction. */
    replace(itemId: number, tags: string[]): void {
      clear.run(itemId);
      for (const tag of tags) add.run(itemId, tag);
    },
    /** [{tag, count}] for every tag some item has, sorted by tag. */
    counts(): { tag: string; count: number }[] {
      return counts.all().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    },
  };
}
