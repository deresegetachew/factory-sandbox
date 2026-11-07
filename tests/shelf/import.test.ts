import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});

const call = (method: string, path: string, body?: unknown, target = app) =>
  target.fetch(
    new Request("http://x" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const create = async (body: unknown) => {
  const res = await call("POST", "/api/items", body);
  expect(res.status).toBe(201);
  return (await res.json()) as any;
};

const importJson = (body: unknown, target = app, headers: Record<string, string> = {}) =>
  target.fetch(
    new Request("http://x/api/import?format=json", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const importCsv = (text: string, target = app) =>
  target.fetch(
    new Request("http://x/api/import?format=csv", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: text,
    }),
  );

const expectError = async (res: Response, status = 400) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as any;
  for (const key of ["code", "message", "fix"]) {
    expect(typeof body.error[key]).toBe("string");
    expect(body.error[key].length).toBeGreaterThan(0);
  }
  return body;
};

const allItems = async (target = app) => (await (await call("GET", "/api/items", undefined, target)).json()) as any[];
const exportJson = async (target = app) => (await (await call("GET", "/api/export?format=json", undefined, target)).json()) as any;
const exportCsv = async (target = app) => await (await call("GET", "/api/export?format=csv", undefined, target)).text();

const HEADER = "title,author,url,kind,status,rating,notes,tags,created_at,finished_at";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const expectAnswerShape = (body: any) => {
  expect(Object.keys(body).sort()).toEqual(["added", "rejected", "skipped"]);
  expect(typeof body.added).toBe("number");
  for (const e of [...body.skipped, ...body.rejected]) {
    expect(Object.keys(e).sort()).toEqual(["reason", "row"]);
    expect(typeof e.row).toBe("number");
    expect(typeof e.reason).toBe("string");
    expect(e.reason.length).toBeGreaterThan(0);
  }
};

const noIds = (items: any[]) => items.map(({ id, ...rest }) => rest);

const seed = async (target = app) => {
  const mk = async (body: unknown) => {
    const res = await call("POST", "/api/items", body, target);
    expect(res.status).toBe(201);
    return (await res.json()) as any;
  };
  await mk({
    title: "=HYPERLINK(1)", author: "ሃይሌ ገብረሥላሴ", url: "https://example.com/a", kind: "article",
    status: "done", rating: 5, notes: 'one, two "three"\r\nfour', tags: ["zeta", "alpha", "mid"],
    finished_at: "2024-03-31T23:59:59Z",
  });
  await mk({ title: "Dune 😀" });
  await mk({ title: "Plain", author: "Ann", kind: "book", status: "reading", rating: 3, notes: "ok", tags: ["x"] });
  const cleared = await mk({ title: "Cleared", status: "done", rating: 4 });
  const res = await call("PATCH", `/api/items/${cleared.id}`, { finished_at: null }, target);
  expect(res.status).toBe(200);
  await mk({ title: "Emoji 🎉 notes", notes: "ሰላም, \"quoted\"\r\nline", tags: ["é", "b"] });
};

describe("round trips", () => {
  test("JSON export imported into an empty shelf exports the same items, ignoring ids", async () => {
    await seed();
    const before = await exportJson();
    expect(before.items.length).toBe(5);
    const fresh = createApp(":memory:");
    const res = await importJson(JSON.stringify(before), fresh);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expectAnswerShape(body);
    expect(body).toEqual({ added: 5, skipped: [], rejected: [] });
    const after = await exportJson(fresh);
    expect(noIds(after.items)).toEqual(noIds(before.items));
  });

  test("CSV export imported into an empty shelf exports exactly the same CSV text", async () => {
    await seed();
    const before = await exportCsv();
    const fresh = createApp(":memory:");
    const res = await importCsv(before, fresh);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 5, skipped: [], rejected: [] });
    expect(await exportCsv(fresh)).toBe(before);
  });
});

describe("answer and bad rows", () => {
  test("a JSON file with one bad row (rating 9) adds the good rows and reports the bad one with its row number", async () => {
    const res = await importJson({
      version: 1,
      items: [{ title: "A" }, { title: "B", rating: 9 }, { title: "C" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expectAnswerShape(body);
    expect(body.added).toBe(2);
    expect(body.skipped).toEqual([]);
    expect(body.rejected.length).toBe(1);
    expect(body.rejected[0].row).toBe(2);
    expect((await allItems()).map((i) => i.title).sort()).toEqual(["A", "C"]);
  });

  test("a CSV file with one bad row (rating 9) adds the good rows and reports the bad one", async () => {
    const res = await importCsv(`title,rating\r\nA,3\r\nB,9\r\nC,\r\n`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expectAnswerShape(body);
    expect(body.added).toBe(2);
    expect(body.rejected.map((r: any) => r.row)).toEqual([2]);
    expect((await allItems()).map((i) => i.title).sort()).toEqual(["A", "C"]);
  });

  test("rejected rows are listed in row order, one for each kind of invalid value", async () => {
    const items = [
      { title: "ok1" },
      { title: "   " },
      { title: "r0", rating: 0 },
      { title: "r6", rating: 6 },
      { title: "r25", rating: 2.5 },
      { title: "st", status: "nope" },
      { title: "kd", kind: "nope" },
      { title: "js", url: "javascript:alert(1)" },
      { title: "fin", status: "done", finished_at: "not a date" },
      { title: "cr", created_at: "yesterday" },
      { title: "ok2" },
    ];
    const res = await importJson({ version: 1, items });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expectAnswerShape(body);
    expect(body.added).toBe(2);
    expect(body.rejected.map((r: any) => r.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await allItems()).map((i) => i.title).sort()).toEqual(["ok1", "ok2"]);
  });
});

describe("duplicates", () => {
  test("importing the same file twice adds nothing the second time and skips every row", async () => {
    const file = JSON.stringify({ version: 1, items: [{ title: "A", url: "https://a.example/" }, { title: "B" }, { title: "C", author: "Z" }] });
    const first = (await (await importJson(file)).json()) as any;
    expect(first.added).toBe(3);
    const res = await importJson(file);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expectAnswerShape(body);
    expect(body.added).toBe(0);
    expect(body.rejected).toEqual([]);
    expect(body.skipped.map((s: any) => s.row)).toEqual([1, 2, 3]);
    expect(await allItems()).toHaveLength(3);
  });

  test("the same twice-import works for CSV", async () => {
    const text = `title,url\r\nA,https://a.example/\r\nB,\r\n`;
    expect(((await (await importCsv(text)).json()) as any).added).toBe(2);
    const body = (await (await importCsv(text)).json()) as any;
    expect(body.added).toBe(0);
    expect(body.skipped.map((s: any) => s.row)).toEqual([1, 2]);
    expect(await allItems()).toHaveLength(2);
  });

  test("URLs match case-insensitively, whatever the title", async () => {
    await create({ title: "Old", url: "https://Example.com/Path" });
    const body = (await (await importJson({ items: [{ title: "Different", url: "https://example.COM/path" }] })).json()) as any;
    expect(body.added).toBe(0);
    expect(body.skipped.map((s: any) => s.row)).toEqual([1]);
    expect(body.rejected).toEqual([]);
  });

  test("with no URL, title and author match case-insensitively; a null author counts as empty", async () => {
    await create({ title: "Dune", author: "Frank Herbert" });
    await create({ title: "Solo" });
    const body = (await (await importJson({
      items: [
        { title: "  DUNE ", author: "frank herbert" },
        { title: "solo", author: null },
        { title: "Dune", author: "Someone Else" },
        { title: "Dune" },
      ],
    })).json()) as any;
    expect(body.added).toBe(2);
    expect(body.skipped.map((s: any) => s.row)).toEqual([1, 2]);
  });

  test("a duplicate of an existing item says it is already on the shelf", async () => {
    await create({ title: "Dune" });
    const body = (await (await importJson({ items: [{ title: "Dune" }] })).json()) as any;
    expect(body.skipped[0].reason.toLowerCase()).toContain("already on the shelf");
  });

  test("a duplicate of an earlier row in the same file mentions that row's number", async () => {
    const body = (await (await importJson({ items: [{ title: "X" }, { title: "Y" }, { title: "y" }] })).json()) as any;
    expect(body.added).toBe(2);
    expect(body.skipped.map((s: any) => s.row)).toEqual([3]);
    expect(body.skipped[0].reason).toContain("2");
    expect(body.skipped[0].reason.toLowerCase()).not.toContain("already on the shelf");
  });

  test("duplicates are skipped, not rejected, and rows rejected for being invalid do not count as earlier rows", async () => {
    const body = (await (await importJson({
      items: [{ title: "A", rating: 9 }, { title: "A" }, { title: "A" }],
    })).json()) as any;
    expect(body.added).toBe(1);
    expect(body.rejected.map((r: any) => r.row)).toEqual([1]);
    expect(body.skipped.map((s: any) => s.row)).toEqual([3]);
  });
});

describe("existing items are never changed", () => {
  test("an import with duplicates of existing items (different notes, status, rating) leaves them identical", async () => {
    await create({ title: "One", url: "https://one.example/", notes: "mine", status: "reading", rating: 2, tags: ["a"] });
    await create({ title: "Two", author: "Bo", status: "done", rating: 5, finished_at: "2024-01-02T03:04:05Z" });
    const before = await exportJson();
    const body = (await (await importJson({
      version: 1,
      items: [
        { title: "One again", url: "https://ONE.example/", notes: "theirs", status: "done", rating: 5, tags: ["z"] },
        { title: "two", author: "BO", notes: "theirs", status: "to_read", rating: 1 },
        { title: "New" },
      ],
    })).json()) as any;
    expect(body.added).toBe(1);
    expect(body.skipped.map((s: any) => s.row)).toEqual([1, 2]);
    const after = await exportJson();
    expect(after.items.slice(0, 2)).toEqual(before.items);
    expect(after.items).toHaveLength(3);
  });
});

describe("bad requests add nothing", () => {
  test.each(["", "xml", "JSON"])("format=%p answers 400 with the error shape", async (format) => {
    const res = await app.fetch(
      new Request("http://x/api/import" + (format ? `?format=${format}` : ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ title: "A" }] }),
      }),
    );
    await expectError(res);
    expect(await allItems()).toEqual([]);
  });

  test("a missing format answers 400", async () => {
    const res = await app.fetch(
      new Request("http://x/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ title: "A" }] }) }),
    );
    await expectError(res);
    expect(await allItems()).toEqual([]);
  });

  test.each([
    ["broken JSON", "{not json"],
    ["an array body", JSON.stringify([{ title: "A" }])],
    ["a missing items", JSON.stringify({ version: 1 })],
    ["items that is not an array", JSON.stringify({ version: 1, items: { title: "A" } })],
    ["version 2", JSON.stringify({ version: 2, items: [{ title: "A" }] })],
  ])("JSON with %s answers 400", async (_name, body) => {
    await expectError(await importJson(body));
    expect(await allItems()).toEqual([]);
  });

  test("a CSV without a title column answers 400", async () => {
    await expectError(await importCsv("author,url\r\nAnn,https://a.example/\r\n"));
    expect(await allItems()).toEqual([]);
  });

  test("an empty CSV body answers 400", async () => {
    await expectError(await importCsv(""));
    expect(await allItems()).toEqual([]);
  });

  test("a CSV the parser refuses (unclosed quote) answers 400 with the line number in the message", async () => {
    const body = await expectError(await importCsv('title\r\nA\r\n"unclosed\r\nB\r\n'));
    expect(body.error.message).toMatch(/\d/);
    expect(await allItems()).toEqual([]);
  });

  test("the line number in the message is the line where the problem is", async () => {
    const body = await expectError(await importCsv('title\nA\nB\n"unclosed\n'));
    expect(body.error.message).toContain("4");
    expect(await allItems()).toEqual([]);
  });
});

describe("JSON items", () => {
  test("id and unknown keys are ignored; items get new ids", async () => {
    const res = await importJson({ items: [{ id: 999, title: "A", isbn: "123", extra: { a: 1 } }] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).added).toBe(1);
    const [item] = await allItems();
    expect(item.title).toBe("A");
    expect(item.id).not.toBe(999);
    expect(item.isbn).toBeUndefined();
  });

  test("a body without version imports; version 1 imports", async () => {
    expect(((await (await importJson({ items: [{ title: "A" }] })).json()) as any).added).toBe(1);
    expect(((await (await importJson({ version: 1, items: [{ title: "B" }] })).json()) as any).added).toBe(1);
  });

  test("an empty items array answers 200 with nothing added", async () => {
    const res = await importJson({ version: 1, items: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 0, skipped: [], rejected: [] });
  });
});

describe("dates", () => {
  test("a valid created_at is kept and stored as UTC ISO", async () => {
    await importJson({ items: [{ title: "A", created_at: "2023-05-06T07:08:09+03:00" }, { title: "B", created_at: "2020-01-02T03:04:05Z" }] });
    const items = await allItems();
    const a = items.find((i) => i.title === "A");
    const b = items.find((i) => i.title === "B");
    expect(a.created_at).toBe("2023-05-06T04:08:09.000Z");
    expect(b.created_at).toBe("2020-01-02T03:04:05.000Z");
  });

  test("a missing or empty created_at means the import time", async () => {
    const t0 = Date.now();
    await importJson({ items: [{ title: "A" }, { title: "B", created_at: "" }] });
    const t1 = Date.now();
    for (const item of await allItems()) {
      expect(item.created_at).toMatch(ISO);
      const t = Date.parse(item.created_at);
      expect(t).toBeGreaterThanOrEqual(t0 - 1000);
      expect(t).toBeLessThanOrEqual(t1 + 1000);
    }
  });

  test("an invalid created_at rejects the row and the good rows are still added", async () => {
    const body = (await (await importJson({ items: [{ title: "A", created_at: "yesterday" }, { title: "B" }] })).json()) as any;
    expect(body.added).toBe(1);
    expect(body.rejected.map((r: any) => r.row)).toEqual([1]);
  });

  test("finished_at from the file is kept, including null for a done item", async () => {
    await importJson({
      items: [
        { title: "A", status: "done", finished_at: "2022-02-03T04:05:06Z" },
        { title: "B", status: "done", finished_at: null },
      ],
    });
    const items = await allItems();
    expect(items.find((i) => i.title === "A").finished_at).toBe("2022-02-03T04:05:06.000Z");
    expect(items.find((i) => i.title === "B").finished_at).toBeNull();
  });

  test("a done JSON item with no finished_at key gets the import time", async () => {
    const t0 = Date.now();
    await importJson({ items: [{ title: "A", status: "done" }] });
    const [item] = await allItems();
    expect(item.finished_at).toMatch(ISO);
    expect(Math.abs(Date.parse(item.finished_at) - t0)).toBeLessThan(5000);
  });

  test("a done CSV row with an empty finished_at keeps null", async () => {
    await importCsv(`title,status,finished_at\r\nA,done,\r\n`);
    const [item] = await allItems();
    expect(item.status).toBe("done");
    expect(item.finished_at).toBeNull();
  });

  test("updated_at from JSON is kept when valid, else the import time", async () => {
    const t0 = Date.now();
    await importJson({
      items: [
        { title: "A", updated_at: "2021-01-02T03:04:05Z" },
        { title: "B", updated_at: "garbage" },
        { title: "C" },
      ],
    });
    const items = await allItems();
    expect(items.find((i) => i.title === "A").updated_at).toBe("2021-01-02T03:04:05.000Z");
    for (const title of ["B", "C"]) {
      const u = items.find((i) => i.title === title).updated_at;
      expect(u).toMatch(ISO);
      expect(Math.abs(Date.parse(u) - t0)).toBeLessThan(5000);
    }
  });
});

describe("CSV cells and shapes", () => {
  test("empty cells mean null (author, url, rating, finished_at) or the default (kind, status)", async () => {
    const res = await importCsv(`${HEADER}\r\nA,,,,,,,,,\r\n`);
    expect(((await res.json()) as any).added).toBe(1);
    const [item] = await allItems();
    expect(item).toMatchObject({ title: "A", author: null, url: null, kind: "book", status: "to_read", rating: null, notes: "", tags: [], finished_at: null });
  });

  test("tags split on ';', are trimmed, and empty parts are dropped", async () => {
    await importCsv(`title,tags\r\nA, b ; ;c;;\r\nB,\r\n`);
    const items = await allItems();
    expect(items.find((i) => i.title === "A").tags).toEqual(["b", "c"]);
    expect(items.find((i) => i.title === "B").tags).toEqual([]);
  });

  test("a rating of digits becomes a number; 9 and abc are rejected rows", async () => {
    const body = (await (await importCsv(`title,rating\r\nA,4\r\nB,9\r\nC,abc\r\n`)).json()) as any;
    expect(body.added).toBe(1);
    expect(body.rejected.map((r: any) => r.row)).toEqual([2, 3]);
    expect((await allItems())[0].rating).toBe(4);
  });

  test("a row with fewer cells than the header gets empty cells", async () => {
    const body = (await (await importCsv(`title,author,url\r\nA\r\nB,Bo\r\n`)).json()) as any;
    expect(body).toEqual({ added: 2, skipped: [], rejected: [] });
    const items = await allItems();
    expect(items.find((i) => i.title === "A")).toMatchObject({ author: null, url: null });
    expect(items.find((i) => i.title === "B")).toMatchObject({ author: "Bo", url: null });
  });

  test("a row with more cells than the header is rejected", async () => {
    const body = (await (await importCsv(`title,author\r\nA,Ann,extra\r\nB,Bo\r\n`)).json()) as any;
    expect(body.added).toBe(1);
    expect(body.rejected.map((r: any) => r.row)).toEqual([1]);
  });

  test("header names are trimmed and case-insensitive, and columns may be in any order", async () => {
    const body = (await (await importCsv(` Author , TITLE ,Rating\r\nAnn,Dune,5\r\n`)).json()) as any;
    expect(body.added).toBe(1);
    expect((await allItems())[0]).toMatchObject({ title: "Dune", author: "Ann", rating: 5 });
  });

  test("a UTF-8 BOM at the start is ignored", async () => {
    const body = (await (await importCsv(`﻿title,author\r\nA,Ann\r\n`)).json()) as any;
    expect(body.added).toBe(1);
    expect((await allItems())[0].title).toBe("A");
  });

  test("CRLF and LF line endings both work", async () => {
    expect(((await (await importCsv("title\r\nA\r\nB\r\n")).json()) as any).added).toBe(2);
    const other = createApp(":memory:");
    expect(((await (await importCsv("title\nA\nB\n", other)).json()) as any).added).toBe(2);
  });

  test("blank lines anywhere are skipped and not counted as rows", async () => {
    const body = (await (await importCsv("title,rating\r\n\r\nA,3\r\n\r\nB,9\r\nC,2\r\n\r\n\r\n")).json()) as any;
    expect(body.added).toBe(2);
    expect(body.rejected.map((r: any) => r.row)).toEqual([2]);
  });

  test("a header-only CSV answers 200 with nothing added", async () => {
    const res = await importCsv(`${HEADER}\r\n`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 0, skipped: [], rejected: [] });
  });

  test("extra unknown columns (isbn) are ignored", async () => {
    const res = await importCsv(`title,isbn,author\r\nA,978-0,Ann\r\n`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).added).toBe(1);
    const [item] = await allItems();
    expect(item).toMatchObject({ title: "A", author: "Ann" });
    expect(item.isbn).toBeUndefined();
  });

  test("a quoted cell with commas, quotes and a CRLF inside keeps its text", async () => {
    await importCsv(`title,notes\r\nA,"x, ""y""\r\nz"\r\n`);
    expect((await allItems())[0].notes).toBe('x, "y"\r\nz');
  });
});

describe("cross-origin", () => {
  test("an import with a foreign Origin answers 403 and adds nothing", async () => {
    const res = await importJson({ items: [{ title: "A" }] }, app, { origin: "http://evil.example" });
    expect(res.status).toBe(403);
    expect(await allItems()).toEqual([]);
  });
});

describe("large file", () => {
  test("a 10,000-row CSV imports with added 10000", async () => {
    const lines = ["title,author,tags"];
    for (let i = 1; i <= 10000; i++) lines.push(`Book ${i},Author ${i % 50},t${i % 7};all`);
    const res = await importCsv(lines.join("\r\n") + "\r\n");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.added).toBe(10000);
    expect(body.skipped).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(await allItems()).toHaveLength(10000);
  }, 30000);
});
