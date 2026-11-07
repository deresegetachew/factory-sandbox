import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/shelf/server";

type App = ReturnType<typeof createApp>;
let app: App;
beforeEach(() => {
  app = createApp(":memory:");
});

const send = (target: App, method: string, path: string, headers: Record<string, string>, body?: string) =>
  target.fetch(new Request("http://x" + path, { method, headers, body }));

const call = (method: string, path: string, body?: unknown, target: App = app) =>
  send(
    target,
    method,
    path,
    { "content-type": "application/json" },
    body === undefined ? undefined : JSON.stringify(body),
  );

const create = async (body: unknown, target: App = app) => {
  const res = await call("POST", "/api/items", body, target);
  expect(res.status).toBe(201);
  return (await res.json()) as any;
};

const putGoal = (year: string | number, body: unknown, target: App = app) => call("PUT", `/api/goals/${year}`, body, target);

const goalOf = async (query = "", target: App = app) => {
  const res = await call("GET", "/api/stats" + query, undefined, target);
  expect(res.status).toBe(200);
  return ((await res.json()) as any).goal;
};

const expectError = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as any;
  for (const key of ["code", "message", "fix"]) {
    expect(typeof body.error[key]).toBe("string");
    expect(body.error[key].length).toBeGreaterThan(0);
  }
};

const seedShelf = async (target: App = app) => {
  await create({ title: "b24", kind: "book", status: "done", finished_at: "2024-05-01T00:00:00Z" }, target);
  await create({ title: "a24", kind: "article", status: "done", finished_at: "2024-06-01T00:00:00Z" }, target);
  await create({ title: "b23", kind: "book", status: "done", finished_at: "2023-06-01T00:00:00Z" }, target);
  await create({ title: "r", kind: "book", status: "reading" }, target);
};

describe("PUT /api/goals/:year", () => {
  test("sets a goal and answers 200 with year as a number", async () => {
    const res = await putGoal(2024, { books: 12 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ year: 2024, books: 12, done: 0 });
  });

  test("the PUT answer carries the current done count", async () => {
    await seedShelf();
    const res = await putGoal(2024, { books: 12 });
    expect(((await res.json()) as any).done).toBe(1);
  });

  test("1 and 1000 are accepted", async () => {
    expect((await putGoal(2024, { books: 1 })).status).toBe(200);
    expect((await putGoal(2024, { books: 1000 })).status).toBe(200);
  });

  test("PUT again replaces the number", async () => {
    await putGoal(2024, { books: 12 });
    const res = await putGoal(2024, { books: 30 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).books).toBe(30);
    expect((await goalOf("?year=2024")).books).toBe(30);
  });

  const badBooks: [string, unknown][] = [
    ["0", { books: 0 }],
    ["1001", { books: 1001 }],
    ["negative", { books: -3 }],
    ["2.5", { books: 2.5 }],
    ['"12" string', { books: "12" }],
    ["null", { books: null }],
    ["missing", {}],
    ["array body", [12]],
    ["string body", "12"],
    ["number body", 12],
    ["null body", null],
  ];
  for (const [name, body] of badBooks) {
    test(`books ${name} answers 400 and sets nothing`, async () => {
      await expectError(await putGoal(2024, body), 400);
      expect(await goalOf("?year=2024")).toBeNull();
    });
  }

  test("invalid JSON answers 400", async () => {
    const res = await send(app, "PUT", "/api/goals/2024", { "content-type": "application/json" }, "{not json");
    await expectError(res, 400);
  });

  for (const year of ["99", "20245", "abcd", "202a", "-2024"]) {
    test(`year ${year} answers 400`, async () => {
      await expectError(await putGoal(year, { books: 5 }), 400);
    });
  }

  test("text/plain Content-Type answers 415 and sets nothing", async () => {
    const res = await send(app, "PUT", "/api/goals/2024", { "content-type": "text/plain" }, JSON.stringify({ books: 5 }));
    await expectError(res, 415);
    expect(await goalOf("?year=2024")).toBeNull();
  });

  test("a foreign Origin answers 403 and sets nothing", async () => {
    const res = await send(
      app,
      "PUT",
      "/api/goals/2024",
      { "content-type": "application/json", origin: "http://evil.example" },
      JSON.stringify({ books: 5 }),
    );
    await expectError(res, 403);
    expect(await goalOf("?year=2024")).toBeNull();
  });
});

describe("DELETE /api/goals/:year", () => {
  test("removes the goal with 204, then stats goal is null, and a second DELETE is 404", async () => {
    await putGoal(2024, { books: 12 });
    const res = await call("DELETE", "/api/goals/2024");
    expect(res.status).toBe(204);
    expect(await goalOf("?year=2024")).toBeNull();
    await expectError(await call("DELETE", "/api/goals/2024"), 404);
  });

  test("404 when no goal was ever set", async () => {
    await expectError(await call("DELETE", "/api/goals/2024"), 404);
  });

  test("deleting one year leaves other years", async () => {
    await putGoal(2024, { books: 12 });
    await putGoal(2025, { books: 7 });
    expect((await call("DELETE", "/api/goals/2024")).status).toBe(204);
    expect((await goalOf("?year=2025")).books).toBe(7);
  });

  for (const year of ["99", "20245", "abcd"]) {
    test(`year ${year} answers 400`, async () => {
      await expectError(await call("DELETE", `/api/goals/${year}`), 400);
    });
  }

  test("a foreign Origin answers 403 and the goal stays", async () => {
    await putGoal(2024, { books: 12 });
    const res = await send(app, "DELETE", "/api/goals/2024", { origin: "http://evil.example" });
    await expectError(res, 403);
    expect((await goalOf("?year=2024")).books).toBe(12);
  });
});

describe("GET /api/stats goal", () => {
  test("goal is null when none is set", async () => {
    expect(await goalOf()).toBeNull();
    expect(await goalOf("?year=2024")).toBeNull();
  });

  test("fixed shelf: counts only done books finished in that UTC year", async () => {
    await seedShelf();
    await putGoal(2024, { books: 12 });
    expect(await goalOf("?year=2024")).toEqual({ year: 2024, books: 12, done: 1 });
  });

  test("no ?year uses the current UTC year", async () => {
    const year = new Date().getUTCFullYear();
    await create({ title: "now", kind: "book", status: "done", finished_at: `${year}-01-01T00:00:00Z` });
    await putGoal(year, { books: 5 });
    expect(await goalOf()).toEqual({ year, books: 5, done: 1 });
  });

  test("a goal for another year does not show for this year", async () => {
    const year = new Date().getUTCFullYear();
    await putGoal(year - 1, { books: 5 });
    expect(await goalOf()).toBeNull();
    expect(await goalOf(`?year=${year}`)).toBeNull();
    expect((await goalOf(`?year=${year - 1}`)).books).toBe(5);
  });

  test("a book finished 2024-12-31T23:30:00Z counts for 2024 and not 2025", async () => {
    await create({ title: "x", status: "done", finished_at: "2024-12-31T23:30:00Z" });
    await putGoal(2024, { books: 3 });
    await putGoal(2025, { books: 3 });
    expect((await goalOf("?year=2024")).done).toBe(1);
    expect((await goalOf("?year=2025")).done).toBe(0);
  });

  test("an offset time 2025-01-01T00:30:00+01:00 counts for 2024", async () => {
    await create({ title: "x", status: "done", finished_at: "2025-01-01T00:30:00+01:00" });
    await putGoal(2024, { books: 3 });
    await putGoal(2025, { books: 3 });
    expect((await goalOf("?year=2024")).done).toBe(1);
    expect((await goalOf("?year=2025")).done).toBe(0);
  });

  test("an item patched from done to reading stops counting", async () => {
    const item = await create({ title: "x", status: "done", finished_at: "2024-05-01T00:00:00Z" });
    await putGoal(2024, { books: 3 });
    expect((await goalOf("?year=2024")).done).toBe(1);
    const res = await call("PATCH", `/api/items/${item.id}`, { status: "reading" });
    expect(res.status).toBe(200);
    expect((await goalOf("?year=2024")).done).toBe(0);
  });

  test("done may exceed books", async () => {
    await create({ title: "x", status: "done", finished_at: "2024-05-01T00:00:00Z" });
    await create({ title: "y", status: "done", finished_at: "2024-06-01T00:00:00Z" });
    await putGoal(2024, { books: 1 });
    expect(await goalOf("?year=2024")).toEqual({ year: 2024, books: 1, done: 2 });
  });

  for (const year of ["99", "20245", "abcd"]) {
    test(`?year=${year} answers 400`, async () => {
      await expectError(await call("GET", `/api/stats?year=${year}`), 400);
    });
  }

  test("byMonth, byTag and totals still describe the shelf when a goal is set", async () => {
    await seedShelf();
    await putGoal(2024, { books: 12 });
    const res = await call("GET", "/api/stats?year=2024");
    const s = (await res.json()) as any;
    expect(s.totals).toEqual({ to_read: 0, reading: 1, done: 3 });
    expect(s.byMonth.map((m: any) => m.month)).toEqual(["2024-06", "2024-05", "2023-06"]);
    expect(s.byTag).toEqual([]);
  });
});

describe("goals and export/import", () => {
  test("export does not contain goals", async () => {
    await putGoal(2024, { books: 12 });
    await create({ title: "x" });
    const res = await call("GET", "/api/export?format=json");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("goal");
    expect(text).not.toContain("books");
  });

  test("importing does not touch the goal", async () => {
    await putGoal(2024, { books: 12 });
    const res = await send(
      app,
      "POST",
      "/api/import?format=json",
      { "content-type": "application/json" },
      JSON.stringify({ items: [{ title: "I", status: "done", finished_at: "2024-02-01T00:00:00Z" }] }),
    );
    expect(res.status).toBeLessThan(300);
    expect(await goalOf("?year=2024")).toEqual({ year: 2024, books: 12, done: 1 });
  });
});

describe("persistence", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("the goal survives a restart", async () => {
    dir = mkdtempSync(join(tmpdir(), "shelf-goals-"));
    const path = join(dir, "shelf.db");
    const first = createApp(path);
    expect((await putGoal(2024, { books: 12 }, first)).status).toBe(200);
    const second = createApp(path);
    expect(await goalOf("?year=2024", second)).toEqual({ year: 2024, books: 12, done: 0 });
  });
});
