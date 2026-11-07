import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});

const call = (method: string, path: string, body?: unknown, raw?: string) =>
  app.fetch(
    new Request("http://x" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const create = async (body: unknown = { title: "Dune" }) => {
  const res = await call("POST", "/api/items", body);
  expect(res.status).toBe(201);
  return (await res.json()) as any;
};

const expectError = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as any;
  for (const key of ["code", "message", "fix"]) {
    expect(typeof body.error[key]).toBe("string");
    expect(body.error[key].length).toBeGreaterThan(0);
  }
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe("POST /api/items", () => {
  test("a title alone answers 201 with defaults: book, to_read, rating null, finished_at null", async () => {
    const item = await create({ title: "Dune" });
    expect(typeof item.id).toBe("number");
    expect(item).toMatchObject({
      title: "Dune",
      author: null,
      url: null,
      kind: "book",
      status: "to_read",
      rating: null,
      notes: "",
      finished_at: null,
    });
  });

  test("created_at and updated_at are ISO 8601 UTC set by the server", async () => {
    const item = await create();
    expect(item.created_at).toMatch(ISO);
    expect(item.updated_at).toMatch(ISO);
  });

  test("all fields can be given and come back", async () => {
    const item = await create({
      title: "Post", author: "Ann", url: "https://example.com/a", kind: "article",
      status: "reading", rating: 4, notes: "good",
    });
    expect(item).toMatchObject({
      title: "Post", author: "Ann", url: "https://example.com/a", kind: "article",
      status: "reading", rating: 4, notes: "good", finished_at: null,
    });
  });

  test("http urls are accepted", async () => {
    expect((await create({ title: "a", url: "http://example.com" })).url).toBe("http://example.com");
  });

  test("title is trimmed", async () => {
    expect((await create({ title: "  Dune  " })).title).toBe("Dune");
  });

  test("status done sets finished_at to now", async () => {
    const before = Date.now();
    const item = await create({ title: "a", status: "done" });
    expect(item.finished_at).toMatch(ISO);
    expect(Date.parse(item.finished_at)).toBeGreaterThanOrEqual(before - 2000);
    expect(Date.parse(item.finished_at)).toBeLessThanOrEqual(Date.now() + 2000);
  });

  test("status done with a given finished_at keeps the given value", async () => {
    const item = await create({ title: "a", status: "done", finished_at: "2020-05-01T00:00:00.000Z" });
    expect(Date.parse(item.finished_at)).toBe(Date.parse("2020-05-01T00:00:00.000Z"));
  });

  test("finished_at may be given by hand for a book finished earlier", async () => {
    const item = await create({ title: "a", finished_at: "2019-01-02T03:04:05.000Z" });
    expect(Date.parse(item.finished_at)).toBe(Date.parse("2019-01-02T03:04:05.000Z"));
  });

  test("the created item can be fetched by id", async () => {
    const item = await create();
    const res = await call("GET", `/api/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(item);
  });
});

describe("validation on POST answers 400 with the error shape", () => {
  const bad: [string, unknown][] = [
    ["blank title", { title: "   " }],
    ["empty title", { title: "" }],
    ["missing title", { author: "x" }],
    ["non-string title", { title: 5 }],
    ["rating 0", { title: "a", rating: 0 }],
    ["rating 6", { title: "a", rating: 6 }],
    ["rating 2.5", { title: "a", rating: 2.5 }],
    ["rating as string", { title: "a", rating: "3" }],
    ["unknown status", { title: "a", status: "abandoned" }],
    ["unknown kind", { title: "a", kind: "podcast" }],
    ["javascript: url", { title: "a", url: "javascript:alert(1)" }],
    ["ftp url", { title: "a", url: "ftp://example.com/x" }],
    ["bad finished_at", { title: "a", finished_at: "not a date" }],
    ["impossible finished_at", { title: "a", finished_at: "2020-13-45" }],
    ["array body", [{ title: "a" }]],
    ["string body", "hello"],
  ];
  for (const [name, body] of bad) {
    test(name, async () => {
      await expectError(await call("POST", "/api/items", body), 400);
    });
  }

  test("malformed JSON body", async () => {
    await expectError(await call("POST", "/api/items", undefined, "{not json"), 400);
  });

  test("a rejected request stores nothing", async () => {
    await call("POST", "/api/items", { title: "   " });
    const res = await call("GET", "/api/items");
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/items", () => {
  test("empty shelf answers 200 with []", async () => {
    const res = await call("GET", "/api/items");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("lists items newest first, even when created in the same millisecond", async () => {
    const a = await create({ title: "first" });
    const b = await create({ title: "second" });
    const c = await create({ title: "third" });
    const res = await call("GET", "/api/items");
    expect(res.status).toBe(200);
    const list = (await res.json()) as any[];
    expect(list.map((i) => i.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe("GET /api/items/:id", () => {
  test("missing id answers 404 with the error shape", async () => {
    await expectError(await call("GET", "/api/items/999"), 404);
  });

  test("non-numeric id answers 404 with the error shape", async () => {
    await expectError(await call("GET", "/api/items/abc"), 404);
  });
});

describe("PATCH /api/items/:id", () => {
  test("changes only the given fields and answers 200 with the item", async () => {
    const item = await create({ title: "Dune", author: "Herbert", notes: "n" });
    const res = await call("PATCH", `/api/items/${item.id}`, { author: "Frank Herbert" });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as any;
    expect(updated).toMatchObject({ id: item.id, title: "Dune", author: "Frank Herbert", notes: "n" });
    const fetched = (await (await call("GET", `/api/items/${item.id}`)).json()) as any;
    expect(fetched.author).toBe("Frank Herbert");
  });

  test("updated_at changes, created_at does not", async () => {
    const item = await create();
    await Bun.sleep(10);
    const updated = (await (await call("PATCH", `/api/items/${item.id}`, { notes: "x" })).json()) as any;
    expect(updated.created_at).toBe(item.created_at);
    expect(updated.updated_at).not.toBe(item.updated_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(item.updated_at));
  });

  test("status done sets finished_at; back to reading clears it", async () => {
    const item = await create();
    const done = (await (await call("PATCH", `/api/items/${item.id}`, { status: "done" })).json()) as any;
    expect(done.status).toBe("done");
    expect(done.finished_at).toMatch(ISO);
    const back = (await (await call("PATCH", `/api/items/${item.id}`, { status: "reading" })).json()) as any;
    expect(back.status).toBe("reading");
    expect(back.finished_at).toBeNull();
  });

  test("an explicit finished_at is kept", async () => {
    const item = await create();
    const when = "2018-06-07T08:09:10.000Z";
    const res = (await (await call("PATCH", `/api/items/${item.id}`, { finished_at: when })).json()) as any;
    expect(Date.parse(res.finished_at)).toBe(Date.parse(when));
    const fetched = (await (await call("GET", `/api/items/${item.id}`)).json()) as any;
    expect(Date.parse(fetched.finished_at)).toBe(Date.parse(when));
  });

  test("status done with a given finished_at in one PATCH: the given value wins", async () => {
    const item = await create();
    const when = "2018-06-07T08:09:10.000Z";
    const res = (await (await call("PATCH", `/api/items/${item.id}`, { status: "done", finished_at: when })).json()) as any;
    expect(res.status).toBe("done");
    expect(Date.parse(res.finished_at)).toBe(Date.parse(when));
  });

  test("PATCH to done on an item already done keeps its finished_at", async () => {
    const when = "2017-01-01T00:00:00.000Z";
    const item = await create({ title: "a", status: "done", finished_at: when });
    const res = (await (await call("PATCH", `/api/items/${item.id}`, { status: "done" })).json()) as any;
    expect(Date.parse(res.finished_at)).toBe(Date.parse(when));
  });

  test("rating can be set and then cleared with null", async () => {
    const item = await create({ title: "a", rating: 5 });
    const cleared = (await (await call("PATCH", `/api/items/${item.id}`, { rating: null })).json()) as any;
    expect(cleared.rating).toBeNull();
    const fetched = (await (await call("GET", `/api/items/${item.id}`)).json()) as any;
    expect(fetched.rating).toBeNull();
  });

  test("title is trimmed on PATCH", async () => {
    const item = await create();
    const res = (await (await call("PATCH", `/api/items/${item.id}`, { title: "  New  " })).json()) as any;
    expect(res.title).toBe("New");
  });

  test("missing id answers 404 with the error shape", async () => {
    await expectError(await call("PATCH", "/api/items/999", { notes: "x" }), 404);
  });

  test("non-numeric id answers 404 with the error shape", async () => {
    await expectError(await call("PATCH", "/api/items/abc", { notes: "x" }), 404);
  });

  const bad: [string, unknown][] = [
    ["blank title", { title: "  " }],
    ["wrong-typed title", { title: 5 }],
    ["rating 0", { rating: 0 }],
    ["rating 6", { rating: 6 }],
    ["rating 2.5", { rating: 2.5 }],
    ["unknown status", { status: "abandoned" }],
    ["unknown kind", { kind: "podcast" }],
    ["javascript: url", { url: "javascript:alert(1)" }],
    ["bad finished_at", { finished_at: "yesterday-ish" }],
    ["array body", [{ title: "a" }]],
    ["string body", "hello"],
  ];
  for (const [name, body] of bad) {
    test(`invalid input (${name}) answers 400 and leaves the item unchanged`, async () => {
      const item = await create({ title: "Keep", rating: 3 });
      await expectError(await call("PATCH", `/api/items/${item.id}`, body), 400);
      const fetched = (await (await call("GET", `/api/items/${item.id}`)).json()) as any;
      expect(fetched).toMatchObject({ title: "Keep", rating: 3, status: "to_read", kind: "book", url: null });
    });
  }

  test("malformed JSON body answers 400", async () => {
    const item = await create();
    await expectError(await call("PATCH", `/api/items/${item.id}`, undefined, "{oops"), 400);
  });
});

describe("DELETE /api/items/:id", () => {
  test("answers 204 with an empty body and the item is gone", async () => {
    const item = await create();
    const res = await call("DELETE", `/api/items/${item.id}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    await expectError(await call("GET", `/api/items/${item.id}`), 404);
    expect(await (await call("GET", "/api/items")).json()).toEqual([]);
  });

  test("deleting one item leaves the others", async () => {
    const a = await create({ title: "a" });
    const b = await create({ title: "b" });
    await call("DELETE", `/api/items/${a.id}`);
    const list = (await (await call("GET", "/api/items")).json()) as any[];
    expect(list.map((i) => i.id)).toEqual([b.id]);
  });

  test("missing id answers 404 with the error shape", async () => {
    await expectError(await call("DELETE", "/api/items/999"), 404);
  });

  test("deleting twice: second answers 404", async () => {
    const item = await create();
    await call("DELETE", `/api/items/${item.id}`);
    await expectError(await call("DELETE", `/api/items/${item.id}`), 404);
  });

  test("non-numeric id answers 404 with the error shape", async () => {
    await expectError(await call("DELETE", "/api/items/abc"), 404);
  });
});

describe("text handling", () => {
  const texts: [string, string][] = [
    ["Amharic", "የሰው ልጅ ታሪክ"],
    ["Japanese", "吾輩は猫である"],
    ["emoji", "Reading 📚🔥 👩🏽‍💻"],
    ["quotes", `He said "hi" and 'bye' \\ back`],
    ["SQL injection", "'); DROP TABLE items;--"],
  ];
  for (const [name, text] of texts) {
    test(`${name} in title and notes comes back unchanged`, async () => {
      const item = await create({ title: text, notes: text, author: text });
      expect(item).toMatchObject({ title: text, notes: text, author: text });
      const fetched = (await (await call("GET", `/api/items/${item.id}`)).json()) as any;
      expect(fetched).toMatchObject({ title: text, notes: text, author: text });
      const list = (await (await call("GET", "/api/items")).json()) as any[];
      expect(list[0].title).toBe(text);
    });
  }

  test("a SQL-looking title is stored as text and the table survives", async () => {
    await create({ title: "'); DROP TABLE items;--" });
    const item = await create({ title: "after" });
    const list = (await (await call("GET", "/api/items")).json()) as any[];
    expect(list.map((i) => i.title)).toEqual(["after", "'); DROP TABLE items;--"]);
    expect(item.title).toBe("after");
  });

  test("a SQL-looking title via PATCH is stored as text", async () => {
    const item = await create();
    const evil = "x'; DELETE FROM items;--";
    const res = (await (await call("PATCH", `/api/items/${item.id}`, { title: evil, notes: evil })).json()) as any;
    expect(res).toMatchObject({ title: evil, notes: evil });
    expect(await (await call("GET", `/api/items/${item.id}`)).status).toBe(200);
  });

  test("100 KB of notes round-trips intact", async () => {
    const notes = "ab😀ሰ".repeat(Math.ceil(100_000 / 4)).slice(0, 100_000);
    const item = await create({ title: "long", notes });
    expect(item.notes).toBe(notes);
    const fetched = (await (await call("GET", `/api/items/${item.id}`)).json()) as any;
    expect(fetched.notes).toBe(notes);
  });
});
