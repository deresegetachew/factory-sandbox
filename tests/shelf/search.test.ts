import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;

const call = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request("http://x" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const expectError = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as any;
  for (const key of ["code", "message", "fix"]) {
    expect(typeof body.error[key]).toBe("string");
    expect(body.error[key].length).toBeGreaterThan(0);
  }
};

// Created in this order, so the list answers them newest first (last one first).
const SHELF = [
  { title: "Dune", author: "Frank Herbert", kind: "book", status: "done", rating: 5, notes: "Spice and sandworms", tags: ["Sci-Fi", "classic"] },
  { title: "Дюна", kind: "book", status: "to_read", tags: ["sci-fi"] },
  { title: "100% sure", kind: "article", status: "reading", rating: 3, tags: ["opinion"] },
  { title: "1000 things", kind: "article", status: "to_read", rating: 4 },
  { title: "a_b", kind: "book", status: "done", rating: 4, notes: "underscore", tags: ["sci-fi"] },
  { title: "axb", kind: "book", status: "done", rating: 2 },
  { title: "Brien's Day", author: "Flann O'Brien", kind: "book", status: "to_read", notes: 'He said "hello"' },
  { title: "日本の旅", kind: "article", status: "reading", rating: 5, tags: ["日本"] },
  { title: "ዱን ታሪክ", kind: "book", status: "done" },
];

beforeEach(async () => {
  app = createApp(":memory:");
  for (const item of SHELF) {
    const res = await call("POST", "/api/items", item);
    expect(res.status).toBe(201);
  }
});

/** GET /api/items with the given query string; returns the titles in the order answered. */
const titles = async (query: string) => {
  const res = await call("GET", "/api/items" + query);
  expect(res.status).toBe(200);
  const list = (await res.json()) as any[];
  expect(Array.isArray(list)).toBe(true);
  return list.map((i) => i.title);
};
const qs = (params: Record<string, string>) => "?" + new URLSearchParams(params).toString();

describe("no filters", () => {
  test("no params returns every item, newest first", async () => {
    expect(await titles("")).toEqual([...SHELF].reverse().map((i) => i.title));
  });

  test("unknown query parameters are ignored", async () => {
    expect(await titles("?colour=red&page=2")).toEqual([...SHELF].reverse().map((i) => i.title));
  });

  test("empty status, kind, tag, min_rating and q mean no filter", async () => {
    expect(await titles("?status=&kind=&tag=&min_rating=&q=")).toEqual([...SHELF].reverse().map((i) => i.title));
  });

  test("whitespace-only q means no filter", async () => {
    expect(await titles(qs({ q: "   " }))).toEqual([...SHELF].reverse().map((i) => i.title));
  });

  test("results still carry tags", async () => {
    const list = (await (await call("GET", "/api/items" + qs({ q: "dune" }))).json()) as any[];
    expect(list[0].tags).toEqual(["classic", "sci-fi"]);
  });
});

describe("each parameter alone", () => {
  test("status=done", async () => {
    expect(await titles("?status=done")).toEqual(["ዱን ታሪክ", "axb", "a_b", "Dune"]);
  });

  test("status=reading", async () => {
    expect(await titles("?status=reading")).toEqual(["日本の旅", "100% sure"]);
  });

  test("kind=article", async () => {
    expect(await titles("?kind=article")).toEqual(["日本の旅", "1000 things", "100% sure"]);
  });

  test("tag=sci-fi", async () => {
    expect(await titles("?tag=sci-fi")).toEqual(["a_b", "Дюна", "Dune"]);
  });

  test("min_rating=4 returns items rated 4 or 5 and excludes unrated ones", async () => {
    expect(await titles("?min_rating=4")).toEqual(["日本の旅", "a_b", "1000 things", "Dune"]);
  });

  test("min_rating=5 returns only 5-star items", async () => {
    expect(await titles("?min_rating=5")).toEqual(["日本の旅", "Dune"]);
  });

  test("min_rating=1 returns every rated item and no unrated one", async () => {
    expect(await titles("?min_rating=1")).toEqual(["日本の旅", "axb", "a_b", "1000 things", "100% sure", "Dune"]);
  });

  test("q alone matches a title", async () => {
    expect(await titles("?q=sure")).toEqual(["100% sure"]);
  });

  test("q matches an author", async () => {
    expect(await titles("?q=herbert")).toEqual(["Dune"]);
  });

  test("q finds an item by a word in its notes", async () => {
    expect(await titles("?q=sandworms")).toEqual(["Dune"]);
  });

  test("q finds an item by a tag", async () => {
    expect(await titles("?q=classic")).toEqual(["Dune"]);
    expect(await titles("?q=opinion")).toEqual(["100% sure"]);
  });

  test("q matching nothing answers an empty list", async () => {
    expect(await titles("?q=zzzzz")).toEqual([]);
  });
});

describe("combined filters", () => {
  test("q+status+tag+min_rating together return exactly the matching items", async () => {
    expect(await titles("?q=sci&status=done&tag=sci-fi&min_rating=4")).toEqual(["a_b", "Dune"]);
  });

  test("raising min_rating to 5 in the same query leaves only Dune", async () => {
    expect(await titles("?q=sci&status=done&tag=sci-fi&min_rating=5")).toEqual(["Dune"]);
  });

  test("status+kind combine with AND", async () => {
    expect(await titles("?status=reading&kind=article&min_rating=4")).toEqual(["日本の旅"]);
  });

  test("filters that share no item answer an empty list", async () => {
    expect(await titles("?status=to_read&min_rating=4&tag=sci-fi")).toEqual([]);
  });
});

describe("q matching", () => {
  test("is case-insensitive: DUNE finds Dune", async () => {
    expect(await titles("?q=DUNE")).toEqual(["Dune"]);
    expect(await titles("?q=dUnE")).toEqual(["Dune"]);
  });

  test("is case-insensitive for notes, tags and authors", async () => {
    expect(await titles("?q=SANDWORMS")).toEqual(["Dune"]);
    expect(await titles("?q=CLASSIC")).toEqual(["Dune"]);
    expect(await titles("?q=" + encodeURIComponent("O'BRIEN"))).toEqual(["Brien's Day"]);
  });

  test("is a substring match, not whole words", async () => {
    expect(await titles("?q=dun")).toEqual(["Dune"]);
    expect(await titles("?q=sandw")).toEqual(["Dune"]);
  });

  test("is trimmed", async () => {
    expect(await titles(qs({ q: "  dune  " }))).toEqual(["Dune"]);
  });

  test("folds non-ASCII case: ДЮНА finds Дюна", async () => {
    expect(await titles(qs({ q: "ДЮНА" }))).toEqual(["Дюна"]);
    expect(await titles(qs({ q: "дюна" }))).toEqual(["Дюна"]);
  });

  test("finds Ethiopic text", async () => {
    expect(await titles(qs({ q: "ዱን" }))).toEqual(["ዱን ታሪክ"]);
  });

  test("finds Japanese text in a title and in a tag", async () => {
    expect(await titles(qs({ q: "日本" }))).toEqual(["日本の旅"]);
    expect(await titles(qs({ q: "旅" }))).toEqual(["日本の旅"]);
  });
});

describe("q is matched literally", () => {
  test("100% matches '100% sure' but not '1000 things'", async () => {
    expect(await titles(qs({ q: "100%" }))).toEqual(["100% sure"]);
  });

  test("a lone % does not match everything", async () => {
    expect(await titles(qs({ q: "%" }))).toEqual(["100% sure"]);
  });

  test("a_b matches 'a_b' but not 'axb'", async () => {
    expect(await titles(qs({ q: "a_b" }))).toEqual(["a_b"]);
  });

  test("a lone _ matches only titles containing an underscore", async () => {
    expect(await titles(qs({ q: "_" }))).toEqual(["a_b"]);
  });

  test("a backslash is literal and matches nothing here", async () => {
    expect(await titles(qs({ q: "\\" }))).toEqual([]);
  });

  test("a single quote works", async () => {
    expect(await titles(qs({ q: "O'Brien" }))).toEqual(["Brien's Day"]);
    expect(await titles(qs({ q: "Brien's" }))).toEqual(["Brien's Day"]);
  });

  test("a double quote works", async () => {
    expect(await titles(qs({ q: 'said "hello"' }))).toEqual(["Brien's Day"]);
  });

  test("an SQL-looking q is just text", async () => {
    expect(await titles(qs({ q: "'; DROP TABLE items; --" }))).toEqual([]);
    expect((await titles("")).length).toBe(SHELF.length);
  });
});

describe("tag filter", () => {
  test("is trimmed and case-insensitive: 'Sci-Fi ' finds sci-fi items", async () => {
    expect(await titles(qs({ tag: " Sci-Fi " }))).toEqual(["a_b", "Дюна", "Dune"]);
  });

  test("is an exact match: 'sci' finds nothing", async () => {
    expect(await titles("?tag=sci")).toEqual([]);
  });

  test("a tag nobody has finds nothing", async () => {
    expect(await titles("?tag=nope")).toEqual([]);
  });

  test("works with non-Latin tags", async () => {
    expect(await titles(qs({ tag: "日本" }))).toEqual(["日本の旅"]);
  });
});

describe("invalid values answer 400 with the error shape", () => {
  test("status=maybe", async () => {
    await expectError(await call("GET", "/api/items?status=maybe"), 400);
  });

  test("kind=film", async () => {
    await expectError(await call("GET", "/api/items?kind=film"), 400);
  });

  for (const bad of ["0", "6", "7", "2.5", "abc", "-1", "1e0", "4x"]) {
    test(`min_rating=${JSON.stringify(bad)}`, async () => {
      await expectError(await call("GET", "/api/items" + qs({ min_rating: bad })), 400);
    });
  }

  test("an invalid value fails even when other filters are valid", async () => {
    await expectError(await call("GET", "/api/items?q=dune&status=maybe"), 400);
  });
});
