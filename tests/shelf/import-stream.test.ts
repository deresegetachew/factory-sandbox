import { describe, expect, test } from "bun:test";
import { csvRecords, parseCsvRecords } from "../../src/shelf/csv";
import { MAX_IMPORT_ROWS, readCsvLines } from "../../src/shelf/import";
import { createApp } from "../../src/shelf/server";

// b25: the CSV import must not hold one array per blank line, and must stop at the row limit instead of parsing
// the whole file first.

const importCsv = (app: ReturnType<typeof createApp>, text: string) =>
  app.fetch(new Request("http://x/api/import?format=csv", { method: "POST", headers: { "content-type": "text/csv" }, body: text }));
const count = async (app: ReturnType<typeof createApp>) =>
  ((await (await app.fetch(new Request("http://x/api/items"))).json()) as unknown[]).length;

const catchError = (fn: () => unknown): { code?: string; message: string } => {
  try {
    fn();
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("expected a throw");
};

describe("csvRecords", () => {
  test("is lazy: early records come out before a later parse error is reached", () => {
    const text = 'a\nb\n"never closed';
    const it = csvRecords(text);
    const first = it.next();
    const second = it.next();
    expect([first.value, second.value]).toEqual([["a"], ["b"]]);
    expect(() => [...csvRecords(text)]).toThrow(/line 3/i);
  });

  test("yields the same records as parseCsvRecords", () => {
    const inputs = ["a\n\nb\n", "a,b\r\n\r\nc,d\r\n", 'x,"line\nbreak",y\nz\n', "a,b", "a\n", '""\n', "  \r\n", "a,\n\n\n"];
    for (const x of inputs) expect([...csvRecords(x)]).toEqual(parseCsvRecords(x));
  });
});

describe("readCsvLines", () => {
  test("skips blank lines without keeping them", () => {
    expect(readCsvLines("title\n" + "\n".repeat(200_000) + "A\n\nB\n")).toEqual([["title"], ["A"], ["B"]]);
  });

  test("stops at the limit without parsing the rest of the text", () => {
    const err = catchError(() => readCsvLines('title\na\nb\nc\nd\n"never closed', 3));
    expect(err.code).toBe("too_many_rows");
  });

  test("blank lines do not count toward the limit", () => {
    expect(readCsvLines("title\n" + "\n".repeat(50) + "a\nb\nc\n", 3)).toHaveLength(4);
  });

  test("exactly the limit is accepted", () => {
    expect(readCsvLines("title\na\nb\nc\n", 3)).toEqual([["title"], ["a"], ["b"], ["c"]]);
  });

  test("a parse error is invalid_csv and names the line", () => {
    const err = catchError(() => readCsvLines('title\na\n"never closed'));
    expect(err.code).toBe("invalid_csv");
    expect(err.message).toMatch(/line 3/i);
  });

  test("strips a BOM and handles CRLF", () => {
    expect(readCsvLines("﻿title,author\r\nA,x\r\n\r\nB,y\r\n")).toEqual([
      ["title", "author"],
      ["A", "x"],
      ["B", "y"],
    ]);
  });
});

describe("POST /api/import?format=csv bounds", () => {
  test(`${MAX_IMPORT_ROWS + 1} data rows answers 400 too_many_rows and adds nothing`, async () => {
    const app = createApp(":memory:");
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Book ${i}`);
    const res = await importCsv(app, "title\n" + lines.join("\n") + "\n");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("too_many_rows");
    expect(await count(app)).toBe(0);
  }, 60000);

  test(`exactly ${MAX_IMPORT_ROWS} data rows are imported`, async () => {
    const app = createApp(":memory:");
    const lines = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `Book ${i}`);
    const res = await importCsv(app, "title\n" + lines.join("\n") + "\n");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { added: number }).added).toBe(MAX_IMPORT_ROWS);
  }, 60000);

  test("a million blank lines between rows are skipped and row numbers ignore them", async () => {
    const app = createApp(":memory:");
    const res = await importCsv(app, "title\n" + "\n".repeat(1_000_000) + "A\n\"\"\nB\n");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; skipped: unknown[]; rejected: { row: number }[] };
    expect(body.added).toBe(2);
    expect(body.skipped).toEqual([]);
    expect(body.rejected.map((r) => r.row)).toEqual([2]);
  }, 60000);
});
