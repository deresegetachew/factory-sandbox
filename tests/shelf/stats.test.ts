import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});

const call = (method: string, path: string, body?: unknown) =>
  app.fetch(
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

const patch = async (id: number, body: unknown) => {
  const res = await call("PATCH", `/api/items/${id}`, body);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};

const stats = async () => {
  const res = await call("GET", "/api/stats");
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};

describe("GET /api/stats", () => {
  test("an empty shelf answers empty lists and zero totals", async () => {
    expect(await stats()).toEqual({
      byMonth: [],
      byTag: [],
      totals: { to_read: 0, reading: 0, done: 0 },
      goal: null,
    });
  });

  test("fixed shelf: byMonth, byTag and totals equal the expected values", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-03-31T23:59:59Z", tags: ["b", "a"] });
    await create({ title: "b", status: "done", finished_at: "2024-04-01T01:30:00+02:00", tags: ["a"] });
    await create({ title: "c", status: "done", finished_at: "2024-04-01T00:00:00Z", tags: ["c"] });
    await create({ title: "d", status: "done", finished_at: "2025-01-15", tags: [] });
    await create({ title: "e", status: "done", finished_at: "2024-12-31T12:00:00Z" });
    await create({ title: "f", status: "reading", tags: ["a", "c"] });
    await create({ title: "g", tags: ["b"] });
    await create({ title: "h" });

    expect(await stats()).toEqual({
      byMonth: [
        { month: "2025-01", done: 1 },
        { month: "2024-12", done: 1 },
        { month: "2024-04", done: 1 },
        { month: "2024-03", done: 2 },
      ],
      byTag: [
        { tag: "a", total: 3, done: 2 },
        { tag: "b", total: 2, done: 1 },
        { tag: "c", total: 2, done: 1 },
      ],
      totals: { to_read: 2, reading: 1, done: 5 },
      goal: null,
    });
  });

  test("last second of a UTC month counts in that month", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-03-31T23:59:59Z" });
    expect((await stats()).byMonth).toEqual([{ month: "2024-03", done: 1 }]);
  });

  test("an offset date-time is bucketed by its UTC month", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-04-01T01:30:00+02:00" });
    expect((await stats()).byMonth).toEqual([{ month: "2024-03", done: 1 }]);
  });

  test("months are newest first across years", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-12-10T00:00:00Z" });
    await create({ title: "b", status: "done", finished_at: "2025-01-02T00:00:00Z" });
    await create({ title: "c", status: "done", finished_at: "2023-06-02T00:00:00Z" });
    expect((await stats()).byMonth.map((m: any) => m.month)).toEqual(["2025-01", "2024-12", "2023-06"]);
  });

  test("months with no finished items are left out", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-01-10T00:00:00Z" });
    await create({ title: "b", status: "done", finished_at: "2024-05-10T00:00:00Z" });
    expect((await stats()).byMonth).toEqual([
      { month: "2024-05", done: 1 },
      { month: "2024-01", done: 1 },
    ]);
  });

  test("an item that is not done but has a finished_at is not in byMonth, yet counts in totals", async () => {
    await create({ title: "a", status: "reading", finished_at: "2024-03-10T00:00:00Z" });
    const s = await stats();
    expect(s.byMonth).toEqual([]);
    expect(s.totals).toEqual({ to_read: 0, reading: 1, done: 0 });
  });

  test("a done item with finished_at cleared is not in byMonth, yet counts in totals", async () => {
    const item = await create({ title: "a", status: "done", finished_at: "2024-03-10T00:00:00Z" });
    await patch(item.id, { finished_at: null });
    const s = await stats();
    expect(s.byMonth).toEqual([]);
    expect(s.totals).toEqual({ to_read: 0, reading: 0, done: 1 });
  });

  test("an item with several tags counts once per tag", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-03-10T00:00:00Z", tags: ["a", "b"] });
    const s = await stats();
    expect(s.byTag).toEqual([
      { tag: "a", total: 1, done: 1 },
      { tag: "b", total: 1, done: 1 },
    ]);
    expect(s.byMonth).toEqual([{ month: "2024-03", done: 1 }]);
    expect(s.totals.done).toBe(1);
  });

  test("done items without tags count in byMonth and totals but add nothing to byTag", async () => {
    await create({ title: "a", status: "done", finished_at: "2024-03-10T00:00:00Z" });
    expect(await stats()).toEqual({
      byMonth: [{ month: "2024-03", done: 1 }],
      byTag: [],
      totals: { to_read: 0, reading: 0, done: 1 },
      goal: null,
    });
  });

  test("byTag lists tags with no done items with done 0, sorted by tag", async () => {
    await create({ title: "a", tags: ["zeta", "alpha"] });
    await create({ title: "b", tags: ["mid"] });
    expect((await stats()).byTag).toEqual([
      { tag: "alpha", total: 1, done: 0 },
      { tag: "mid", total: 1, done: 0 },
      { tag: "zeta", total: 1, done: 0 },
    ]);
  });

  test("moving an item out of done removes it from byMonth, byTag done and totals", async () => {
    const item = await create({ title: "a", status: "done", finished_at: "2024-03-10T00:00:00Z", tags: ["x"] });
    await create({ title: "b", status: "done", finished_at: "2024-05-10T00:00:00Z", tags: ["x"] });
    await patch(item.id, { status: "reading" });
    expect(await stats()).toEqual({
      byMonth: [{ month: "2024-05", done: 1 }],
      byTag: [{ tag: "x", total: 2, done: 1 }],
      totals: { to_read: 0, reading: 1, done: 1 },
      goal: null,
    });
  });

  test("after moving the only done item out of done, its month disappears", async () => {
    const item = await create({ title: "a", status: "done", finished_at: "2024-03-10T00:00:00Z" });
    await patch(item.id, { status: "reading" });
    expect((await stats()).byMonth).toEqual([]);
  });

  test("a deleted item leaves byMonth, byTag and totals", async () => {
    const item = await create({ title: "a", status: "done", finished_at: "2024-03-10T00:00:00Z", tags: ["x"] });
    const res = await call("DELETE", `/api/items/${item.id}`);
    expect(res.status).toBeLessThan(300);
    expect(await stats()).toEqual({
      byMonth: [],
      byTag: [],
      totals: { to_read: 0, reading: 0, done: 0 },
      goal: null,
    });
  });

  test("POST /api/stats is not a route and answers 404 with the error shape", async () => {
    const res = await call("POST", "/api/stats", {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    for (const key of ["code", "message", "fix"]) {
      expect(typeof body.error[key]).toBe("string");
      expect(body.error[key].length).toBeGreaterThan(0);
    }
  });
});
