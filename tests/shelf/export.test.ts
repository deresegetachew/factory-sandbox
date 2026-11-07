import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";
import { parseCsv, writeCsv } from "../../src/shelf/csv";

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

const expectError = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as any;
  for (const key of ["code", "message", "fix"]) {
    expect(typeof body.error[key]).toBe("string");
    expect(body.error[key].length).toBeGreaterThan(0);
  }
};

const today = () => new Date().toISOString().slice(0, 10);
const HEADER = "title,author,url,kind,status,rating,notes,tags,created_at,finished_at";

// Fixed items, created in this order (so ids ascend).
const seed = async () => {
  const a = await create({
    title: "=HYPERLINK(1)",
    author: "ሃይሌ ገብረሥላሴ",
    url: "https://example.com/a",
    kind: "article",
    status: "done",
    rating: 5,
    notes: 'one, two "three"\r\nfour',
    tags: ["zeta", "alpha", "mid"],
    finished_at: "2024-03-31T23:59:59Z",
  });
  const b = await create({ title: "Dune 😀" });
  const c = await create({ title: "Plain", author: "Ann", kind: "book", status: "reading", rating: 3, notes: "ok", tags: ["x"] });
  // re-read through the API so expectations come from what it answers
  const get = async (id: number) => (await (await call("GET", `/api/items/${id}`)).json()) as any;
  return [await get(a.id), await get(b.id), await get(c.id)];
};

describe("GET /api/export?format=json", () => {
  test("answers 200 JSON with an attachment name shelf-<today>.json", async () => {
    const res = await call("GET", "/api/export?format=json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.startsWith("application/json")).toBe(true);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="shelf-${today()}.json"`);
  });

  test("the body is exactly {version: 1, items} pretty-printed, items oldest first with every field and sorted tags", async () => {
    const items = await seed();
    expect(items[0].tags).toEqual(["alpha", "mid", "zeta"]);
    const res = await call("GET", "/api/export?format=json");
    expect(await res.text()).toBe(JSON.stringify({ version: 1, items }, null, 2) + "\n");
  });

  test("an empty shelf exports items []", async () => {
    const res = await call("GET", "/api/export?format=json");
    expect(await res.text()).toBe(JSON.stringify({ version: 1, items: [] }, null, 2) + "\n");
  });
});

describe("GET /api/export?format=csv", () => {
  test("answers 200 text/csv in UTF-8 with an attachment name shelf-<today>.csv", async () => {
    const res = await call("GET", "/api/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="shelf-${today()}.csv"`);
  });

  test("the body is exactly the literal CSV text for fixed items", async () => {
    const [a, b, c] = await seed();
    const expected =
      HEADER + "\r\n" +
      `=HYPERLINK(1),ሃይሌ ገብረሥላሴ,https://example.com/a,article,done,5,"one, two ""three""\r\nfour",alpha;mid;zeta,${a.created_at},2024-03-31T23:59:59.000Z\r\n` +
      `Dune 😀,,,book,to_read,,,,${b.created_at},\r\n` +
      `Plain,Ann,,book,reading,3,ok,x,${c.created_at},\r\n`;
    const res = await call("GET", "/api/export?format=csv");
    expect(await res.text()).toBe(expected);
  });

  test("the body equals writeCsv of the header plus one row per item, and parses back to the cells", async () => {
    const items = await seed();
    const rows = [
      HEADER.split(","),
      ...items.map((i: any) => [
        i.title, i.author ?? "", i.url ?? "", i.kind, i.status,
        i.rating === null ? "" : String(i.rating), i.notes, i.tags.join(";"),
        i.created_at, i.finished_at ?? "",
      ]),
    ];
    const text = await (await call("GET", "/api/export?format=csv")).text();
    expect(text).toBe(writeCsv(rows));
    expect(parseCsv(text)[1][6]).toBe('one, two "three"\r\nfour');
    expect(parseCsv(text)[1][0]).toBe("=HYPERLINK(1)");
  });

  test("an empty shelf exports only the header row", async () => {
    const res = await call("GET", "/api/export?format=csv");
    expect(await res.text()).toBe(HEADER + "\r\n");
  });
});

describe("bad requests", () => {
  test("format=xml answers 400 with the error shape", async () => {
    await expectError(await call("GET", "/api/export?format=xml"), 400);
  });
  test("format=JSON (case matters) answers 400", async () => {
    await expectError(await call("GET", "/api/export?format=JSON"), 400);
  });
  test("a missing format answers 400", async () => {
    await expectError(await call("GET", "/api/export"), 400);
  });
  test("POST /api/export answers 404", async () => {
    const res = await call("POST", "/api/export?format=json", {});
    expect(res.status).toBe(404);
  });
});
