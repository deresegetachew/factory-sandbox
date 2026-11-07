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

const getItem = async (id: number) => (await (await call("GET", `/api/items/${id}`)).json()) as any;
const allTags = async () => {
  const res = await call("GET", "/api/tags");
  expect(res.status).toBe(200);
  return (await res.json()) as any[];
};

describe("tags on POST", () => {
  test("tags are trimmed, lowercased, deduplicated and sorted", async () => {
    const item = await create({ title: "a", tags: ["Sci-Fi", "sci-fi ", "History"] });
    expect(item.tags).toEqual(["history", "sci-fi"]);
  });

  test("an item created without tags has tags []", async () => {
    expect((await create({ title: "a" })).tags).toEqual([]);
  });

  test("inner spaces are kept", async () => {
    expect((await create({ title: "a", tags: ["Science Fiction"] })).tags).toEqual(["science fiction"]);
  });

  test("non-Latin tags come back unchanged", async () => {
    const item = await create({ title: "a", tags: ["አማርኛ", "日本語"] });
    expect([...item.tags].sort()).toEqual(["አማርኛ", "日本語"].sort());
  });

  test("tags are stored: GET by id returns them", async () => {
    const item = await create({ title: "a", tags: ["b", "A"] });
    expect((await getItem(item.id)).tags).toEqual(["a", "b"]);
  });

  test("GET list includes sorted tags for every item", async () => {
    await create({ title: "a", tags: ["z", "y"] });
    await create({ title: "b" });
    const list = (await (await call("GET", "/api/items")).json()) as any;
    const items: any[] = Array.isArray(list) ? list : list.items;
    expect(items.length).toBe(2);
    expect(items.find((i) => i.title === "a").tags).toEqual(["y", "z"]);
    expect(items.find((i) => i.title === "b").tags).toEqual([]);
  });

  const bad: [string, unknown][] = [
    ["a string", "scifi"],
    ["null", null],
    ["an array of numbers", [1]],
    ["a blank tag", ["ok", ""]],
    ["a whitespace-only tag", ["ok", "   "]],
    ["a tag with ;", ["a;b"]],
    ["a tag with ,", ["a,b"]],
  ];
  for (const [name, tags] of bad) {
    test(`tags as ${name} answers 400 with the error shape and stores nothing`, async () => {
      await expectError(await call("POST", "/api/items", { title: "a", tags }), 400);
      const list = (await (await call("GET", "/api/items")).json()) as any;
      expect((Array.isArray(list) ? list : list.items).length).toBe(0);
      expect(await allTags()).toEqual([]);
    });
  }
});

describe("tags on PATCH", () => {
  test("PATCH with tags replaces the list, normalised and sorted", async () => {
    const item = await create({ title: "a", tags: ["old"] });
    const res = await call("PATCH", `/api/items/${item.id}`, { tags: ["Beta", "alpha", "BETA "] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).tags).toEqual(["alpha", "beta"]);
    expect((await getItem(item.id)).tags).toEqual(["alpha", "beta"]);
  });

  test("PATCH with tags [] removes all tags and GET /api/tags no longer lists them", async () => {
    const item = await create({ title: "a", tags: ["x", "y"] });
    const res = await call("PATCH", `/api/items/${item.id}`, { tags: [] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).tags).toEqual([]);
    expect(await allTags()).toEqual([]);
  });

  test("PATCH without tags keeps the current tags", async () => {
    const item = await create({ title: "a", tags: ["x", "y"] });
    const res = await call("PATCH", `/api/items/${item.id}`, { title: "b" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("b");
    expect(body.tags).toEqual(["x", "y"]);
  });

  const bad: [string, unknown][] = [
    ["a string", "scifi"],
    ["null", null],
    ["an array of numbers", [1]],
    ["a blank tag", ["ok", ""]],
    ["a whitespace-only tag", ["ok", " "]],
    ["a tag with ;", ["a;b"]],
    ["a tag with ,", ["a,b"]],
  ];
  for (const [name, tags] of bad) {
    test(`tags as ${name} answers 400 and leaves fields and tags unchanged`, async () => {
      const item = await create({ title: "a", tags: ["keep"] });
      await expectError(await call("PATCH", `/api/items/${item.id}`, { title: "changed", tags }), 400);
      const after = await getItem(item.id);
      expect(after.title).toBe("a");
      expect(after.tags).toEqual(["keep"]);
    });
  }
});

describe("GET /api/tags", () => {
  test("answers 200 with [] on an empty shelf", async () => {
    expect(await allTags()).toEqual([]);
  });

  test("answers [{tag, count}] sorted by tag", async () => {
    await create({ title: "a", tags: ["zebra", "apple"] });
    await create({ title: "b", tags: ["mango", "apple"] });
    expect(await allTags()).toEqual([
      { tag: "apple", count: 2 },
      { tag: "mango", count: 1 },
      { tag: "zebra", count: 1 },
    ]);
  });

  test("counts each item once per tag even when the tag is repeated", async () => {
    await create({ title: "a", tags: ["Dup", "dup", "DUP "] });
    expect(await allTags()).toEqual([{ tag: "dup", count: 1 }]);
  });

  test("tags with inner spaces and non-Latin tags are listed", async () => {
    await create({ title: "a", tags: ["science fiction", "日本語"] });
    const tags = (await allTags()).map((t) => t.tag);
    expect(tags).toContain("science fiction");
    expect(tags).toContain("日本語");
  });

  test("deleting an item removes its tags from the count", async () => {
    const a = await create({ title: "a", tags: ["shared", "only-a"] });
    await create({ title: "b", tags: ["shared"] });
    const res = await call("DELETE", `/api/items/${a.id}`);
    expect(res.status).toBeLessThan(300);
    expect(await allTags()).toEqual([{ tag: "shared", count: 1 }]);
  });

  test("deleting the only item leaves no tags", async () => {
    const a = await create({ title: "a", tags: ["x"] });
    await call("DELETE", `/api/items/${a.id}`);
    expect(await allTags()).toEqual([]);
  });
});
