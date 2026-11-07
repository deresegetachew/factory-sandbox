import type { Database } from "bun:sqlite";
import { STATUSES } from "./fields";
import type { Goal } from "./goals";

export type Stats = {
  byMonth: { month: string; done: number }[];
  byTag: { tag: string; total: number; done: number }[];
  totals: Record<(typeof STATUSES)[number], number>;
  /** The reading goal for the year asked for (the current UTC year by default), or null when none is set. */
  goal: Goal | null;
};

/**
 * Reading stats for GET /api/stats. finished_at is stored as a UTC ISO string (YYYY-MM-DDTHH:MM:SS.sssZ), so its
 * first 7 characters are the UTC month. byMonth counts only items that are done and have a finished_at.
 */
export function statsQueries(db: Database) {
  const byMonth = db.query<{ month: string; done: number }, []>(
    `SELECT substr(finished_at, 1, 7) AS month, COUNT(*) AS done
       FROM items
      WHERE status = 'done' AND finished_at IS NOT NULL
      GROUP BY month
      ORDER BY month DESC`,
  );
  const byTag = db.query<{ tag: string; total: number; done: number }, []>(
    `SELECT t.tag AS tag, COUNT(*) AS total, SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tags t JOIN items i ON i.id = t.item_id
      GROUP BY t.tag`,
  );
  const totals = db.query<{ status: string; n: number }, []>("SELECT status, COUNT(*) AS n FROM items GROUP BY status");

  return (goal: Goal | null): Stats => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Stats["totals"];
    for (const { status, n } of totals.all()) {
      if (status in counts) counts[status as keyof Stats["totals"]] = n;
    }
    return {
      byMonth: byMonth.all(),
      // Sorted in JS, like the item tags and GET /api/tags, so every tag list uses the same order.
      byTag: byTag.all().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)),
      totals: counts,
      goal,
    };
  };
}
