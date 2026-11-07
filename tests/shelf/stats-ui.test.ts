import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});
const get = (path: string) => app.fetch(new Request("http://x" + path));
const post = (path: string, body: unknown) =>
  app.fetch(new Request("http://x" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const loadData = async () => (await import("../../src/shelf/public/data.js")) as any;
const loadRender = async () => (await import("../../src/shelf/public/render.js")) as any;

// Minimal fake DOM (copied from ui.test.ts).
class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: (FakeNode | string)[] = [];
  listeners: Record<string, Function[]> = {};
  private own = "";
  [k: string]: any;
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...nodes: (FakeNode | string)[]) {
    this.children.push(...nodes);
  }
  setAttribute(n: string, v: string) {
    this.attrs[n] = String(v);
  }
  addEventListener(t: string, fn: Function) {
    (this.listeners[t] ||= []).push(fn);
  }
  set textContent(s: string) {
    this.own = String(s);
    this.children = [];
  }
  get textContent(): string {
    return this.own + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
}
const doc = { createElement: (tag: string) => new FakeNode(tag) };
const walk = (n: FakeNode | string, out: FakeNode[] = []): FakeNode[] => {
  if (typeof n === "string") return out;
  out.push(n);
  for (const c of n.children) walk(c, out);
  return out;
};
const all = (els: FakeNode[]) => els.flatMap((e) => walk(e));
const marked = (els: FakeNode[], name: string) => all(els).filter((n) => n.attrs["data-stats"] === name);

const STATS = {
  byMonth: [
    { month: "2024-05", done: 3 },
    { month: "2024-03", done: 1 },
  ],
  byTag: [
    { tag: "sci-fi", total: 4, done: 2 },
    { tag: "history", total: 1, done: 0 },
  ],
  totals: { to_read: 5, reading: 2, done: 4 },
};

describe("statsTables", () => {
  test("turns a fixed stats answer into string rows in the given order", async () => {
    const { statsTables } = await loadData();
    const t = statsTables(STATS);
    expect(t.months).toEqual([["2024-05", "3"], ["2024-03", "1"]]);
    expect(t.tags).toEqual([["sci-fi", "4", "2"], ["history", "1", "0"]]);
    expect(t.totals).toEqual([["To read", "5"], ["Reading", "2"], ["Done", "4"]]);
    expect(t.nothingFinished).toBe(false);
  });

  test("nothingFinished is true when byMonth is empty", async () => {
    const { statsTables } = await loadData();
    const t = statsTables({ ...STATS, byMonth: [] });
    expect(t.nothingFinished).toBe(true);
    expect(t.months).toEqual([]);
  });

  test("end to end: rows match GET /api/stats for a shelf built through the API", async () => {
    const { statsTables } = await loadData();
    const items = [
      { title: "A", status: "done", finished_at: "2024-03-10T10:00:00Z", tags: ["sci-fi", "classic"] },
      { title: "B", status: "done", finished_at: "2024-05-02T10:00:00Z", tags: ["sci-fi"] },
      { title: "C", status: "done", finished_at: "2024-05-20T10:00:00Z", tags: ["history"] },
      { title: "D", status: "reading", tags: ["sci-fi"] },
      { title: "E", status: "to_read" },
    ];
    for (const i of items) expect((await post("/api/items", i)).status).toBe(201);
    const stats = (await (await get("/api/stats")).json()) as any;
    const t = statsTables(stats);
    expect(stats.byMonth.length).toBeGreaterThan(0);
    expect(t.months).toEqual(stats.byMonth.map((m: any) => [m.month, String(m.done)]));
    expect(t.tags).toEqual(stats.byTag.map((x: any) => [x.tag, String(x.total), String(x.done)]));
    expect(t.totals).toEqual([
      ["To read", String(stats.totals.to_read)],
      ["Reading", String(stats.totals.reading)],
      ["Done", String(stats.totals.done)],
    ]);
    expect(t.nothingFinished).toBe(false);
  });

  test("end to end: an empty shelf gives nothingFinished and zero totals", async () => {
    const { statsTables } = await loadData();
    const stats = (await (await get("/api/stats")).json()) as any;
    const t = statsTables(stats);
    expect(t.nothingFinished).toBe(true);
    expect(t.months).toEqual([]);
    expect(t.tags).toEqual([]);
    expect(t.totals).toEqual([["To read", "0"], ["Reading", "0"], ["Done", "0"]]);
  });
});

describe("importFormat", () => {
  test("json and csv by extension, case-insensitive", async () => {
    const { importFormat } = await loadData();
    expect(importFormat("shelf.json")).toBe("json");
    expect(importFormat("shelf.csv")).toBe("csv");
    expect(importFormat("Shelf.CSV")).toBe("csv");
    expect(importFormat("SHELF.Json")).toBe("json");
  });

  test("anything else gives null", async () => {
    const { importFormat } = await loadData();
    for (const n of ["a.txt", "a.xlsx", "csv", "", "a.json.exe", "a.csv "]) expect(importFormat(n)).toBeNull();
  });
});

describe("importContentType and exportPath", () => {
  test("content types", async () => {
    const { importContentType } = await loadData();
    expect(importContentType("json")).toBe("application/json");
    expect(importContentType("csv")).toBe("text/csv");
  });

  test("export paths", async () => {
    const { exportPath } = await loadData();
    expect(exportPath("json")).toBe("/api/export?format=json");
    expect(exportPath("csv")).toBe("/api/export?format=csv");
  });
});

describe("importProblem", () => {
  test("MAX_IMPORT_BYTES is 20 MB", async () => {
    const { MAX_IMPORT_BYTES } = await loadData();
    expect(MAX_IMPORT_BYTES).toBe(20 * 1024 * 1024);
  });

  test("a sendable file has no problem, including exactly the limit", async () => {
    const { importProblem, MAX_IMPORT_BYTES } = await loadData();
    expect(importProblem({ name: "a.json", size: 10 })).toBeNull();
    expect(importProblem({ name: "a.csv", size: 1 })).toBeNull();
    expect(importProblem({ name: "a.csv", size: MAX_IMPORT_BYTES })).toBeNull();
  });

  test("a wrong type gives a message naming .json and .csv", async () => {
    const { importProblem } = await loadData();
    const m = importProblem({ name: "a.txt", size: 10 });
    expect(typeof m).toBe("string");
    expect(m.length).toBeGreaterThan(0);
    expect(m).toContain(".json");
    expect(m).toContain(".csv");
  });

  test("a file over the limit mentions 20 MB", async () => {
    const { importProblem, MAX_IMPORT_BYTES } = await loadData();
    expect(importProblem({ name: "a.csv", size: MAX_IMPORT_BYTES + 1 })).toContain("20 MB");
  });

  test("an empty file gives a message", async () => {
    const { importProblem } = await loadData();
    const m = importProblem({ name: "a.json", size: 0 });
    expect(typeof m).toBe("string");
    expect(m.length).toBeGreaterThan(0);
  });
});

describe("importSummary", () => {
  test("headline counts added, skipped and rejected", async () => {
    const { importSummary } = await loadData();
    const s = importSummary({ added: 3, skipped: [{ row: 2, reason: "duplicate" }], rejected: [{ row: 5, reason: "bad" }, { row: 6, reason: "worse" }] });
    expect(s.headline).toBe("Added 3, skipped 1, rejected 2");
  });

  test("rows are sorted by row number, rejected first on a tie", async () => {
    const { importSummary } = await loadData();
    const s = importSummary({
      added: 0,
      skipped: [{ row: 7, reason: "dup" }, { row: 3, reason: "dup2" }],
      rejected: [{ row: 7, reason: "no title" }, { row: 1, reason: "bad rating" }],
    });
    expect(s.rows).toEqual([
      { kind: "rejected", row: 1, reason: "bad rating" },
      { kind: "skipped", row: 3, reason: "dup2" },
      { kind: "rejected", row: 7, reason: "no title" },
      { kind: "skipped", row: 7, reason: "dup" },
    ]);
  });

  test("nothing skipped or rejected gives no rows", async () => {
    const { importSummary } = await loadData();
    const s = importSummary({ added: 2, skipped: [], rejected: [] });
    expect(s.headline).toBe("Added 2, skipped 0, rejected 0");
    expect(s.rows).toEqual([]);
  });
});

describe("renderStats", () => {
  test("shows months, tags and totals in marked elements", async () => {
    const { renderStats } = await loadRender();
    const { statsTables } = await loadData();
    const els = renderStats(doc, statsTables(STATS));
    expect(Array.isArray(els)).toBe(true);
    const months = marked(els, "months").map((n) => n.textContent).join("|");
    for (const v of ["2024-05", "3", "2024-03", "1"]) expect(months).toContain(v);
    const tags = marked(els, "tags").map((n) => n.textContent).join("|");
    for (const v of ["sci-fi", "4", "2", "history"]) expect(tags).toContain(v);
    const totals = marked(els, "totals").map((n) => n.textContent).join("|");
    for (const v of ["To read", "5", "Reading", "2", "Done", "4"]) expect(totals).toContain(v);
    expect(all(els).some((n) => n.textContent === "Nothing finished yet")).toBe(false);
  });

  test("an empty shelf says Nothing finished yet and still shows totals", async () => {
    const { renderStats } = await loadRender();
    const { statsTables } = await loadData();
    const els = renderStats(doc, statsTables({ byMonth: [], byTag: [], totals: { to_read: 1, reading: 0, done: 0 } }));
    expect(all(els).filter((n) => n.textContent === "Nothing finished yet").length).toBe(1);
    expect(marked(els, "totals").map((n) => n.textContent).join("|")).toContain("To read");
  });

  test("tag text is set as text, not HTML", async () => {
    const { renderStats } = await loadRender();
    const { statsTables } = await loadData();
    const els = renderStats(doc, statsTables({ ...STATS, byTag: [{ tag: "<b>x</b>", total: 1, done: 1 }] }));
    expect(all(els).some((n) => n.tag === "b")).toBe(false);
    expect(marked(els, "tags").map((n) => n.textContent).join("|")).toContain("<b>x</b>");
  });
});

describe("renderImportResult", () => {
  test("shows the headline and each row's kind, number and reason", async () => {
    const { renderImportResult } = await loadRender();
    const { importSummary } = await loadData();
    const summary = importSummary({ added: 4, skipped: [{ row: 2, reason: "already on the shelf" }], rejected: [{ row: 9, reason: "rating must be 1 to 5" }] });
    const el = renderImportResult(doc, summary);
    expect(Array.isArray(el)).toBe(false);
    const text = el.textContent;
    expect(text).toContain("Added 4, skipped 1, rejected 1");
    for (const v of ["skipped", "2", "already on the shelf", "rejected", "9", "rating must be 1 to 5"]) expect(text).toContain(v);
  });

  test("a reason is text, not HTML", async () => {
    const { renderImportResult } = await loadRender();
    const el = renderImportResult(doc, {
      headline: "Added 0, skipped 0, rejected 1",
      rows: [{ kind: "rejected", row: 1, reason: "<img src=x onerror=alert(1)>" }],
    });
    expect(walk(el).some((n) => n.tag === "img")).toBe(false);
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("page and static files", () => {
  test("GET /data.js is served as JavaScript with the CSP header", async () => {
    const res = await get("/data.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  test("the page has the stats section, export links, import form and result area", async () => {
    const html = await (await get("/")).text();
    expect(html).toMatch(/<section[^>]*\bid="stats"/);
    expect(html).toMatch(/<a\b[^>]*href="\/api\/export\?format=json"/);
    expect(html).toMatch(/<a\b[^>]*href="\/api\/export\?format=csv"/);
    expect(html).toMatch(/<form\b[^>]*\bid="import-form"/);
    expect(html).toMatch(/<input\b(?=[^>]*type="file")(?=[^>]*accept="\.json,\.csv")[^>]*>/);
    expect(html).toMatch(/\bid="import-result"/);
  });

  for (const [fmt, ext] of [["csv", "csv"], ["json", "json"]]) {
    test(`GET /api/export?format=${fmt} names the download shelf-YYYY-MM-DD.${ext}`, async () => {
      const res = await get(`/api/export?format=${fmt}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition") ?? "").toMatch(new RegExp(`^attachment; filename="shelf-\\d{4}-\\d{2}-\\d{2}\\.${ext}"$`));
    });
  }
});
