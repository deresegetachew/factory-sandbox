import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, parseCsvRecords } from "../../src/shelf/csv";
import { MAX_CSV_COLUMNS, MAX_IMPORT_ROWS } from "../../src/shelf/import";
import { createApp, MAX_BODY_BYTES } from "../../src/shelf/server";

// Follow-ups from the b17 reviews: a blank-title row is reported, not silently dropped; JSON keys cannot be mistaken
// for internal markers; very wide or very long files answer 400; the real server caps request bodies.

const importCsv = (app: ReturnType<typeof createApp>, text: string) =>
  app.fetch(new Request("http://x/api/import?format=csv", { method: "POST", headers: { "content-type": "text/csv" }, body: text }));
const importJson = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.fetch(
    new Request("http://x/api/import?format=json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const count = async (app: ReturnType<typeof createApp>) =>
  ((await (await app.fetch(new Request("http://x/api/items"))).json()) as unknown[]).length;

describe("parseCsvRecords", () => {
  test("a truly empty line is [], while an empty or blank cell is a row", () => {
    expect(parseCsvRecords("a\n\nb\n")).toEqual([["a"], [], ["b"]]);
    expect(parseCsvRecords('""\n')).toEqual([[""]]);
    expect(parseCsvRecords("  \r\n")).toEqual([["  "]]);
    expect(parseCsvRecords("a,\n")).toEqual([["a", ""]]);
  });

  test("parseCsv still gives [\"\"] for an empty line", () => {
    expect(parseCsv("a\n\nb\n")).toEqual([["a"], [""], ["b"]]);
  });
});

describe("import never drops a bad row silently", () => {
  test('in a title-only CSV, rows of "" or spaces are rejected with their number; empty lines are skipped', async () => {
    const app = createApp(":memory:");
    const res = await importCsv(app, 'title\nA\n""\n   \n\nB\n\n');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; skipped: unknown[]; rejected: { row: number; reason: string }[] };
    expect(body.added).toBe(2);
    expect(body.rejected.map((r) => r.row)).toEqual([2, 3]);
    for (const r of body.rejected) expect(r.reason.length).toBeGreaterThan(0);
  });

  test("a JSON item whose keys look like internal markers is imported like any other", async () => {
    const app = createApp(":memory:");
    const res = await importJson(app, { version: 1, items: [{ title: "Odd", __notObject: 1, __tooManyCells: 9 }] });
    expect(((await res.json()) as { added: number }).added).toBe(1);
  });

  test("a JSON item that is not an object is rejected with its row number", async () => {
    const app = createApp(":memory:");
    const body = (await (await importJson(app, { items: [{ title: "A" }, "B", null, [1]] })).json()) as {
      added: number;
      rejected: { row: number }[];
    };
    expect(body.added).toBe(1);
    expect(body.rejected.map((r) => r.row)).toEqual([2, 3, 4]);
  });
});

describe("file size limits", () => {
  test(`a CSV header wider than ${MAX_CSV_COLUMNS} columns answers 400 and adds nothing`, async () => {
    const app = createApp(":memory:");
    const header = ["title", ...Array.from({ length: MAX_CSV_COLUMNS }, (_, i) => `x${i}`)].join(",");
    const res = await importCsv(app, `${header}\nA\n`);
    expect(res.status).toBe(400);
    const err = ((await res.json()) as { error: { code: string; message: string; fix: string } }).error;
    expect(err.code).toBe("invalid_csv");
    expect(err.fix.length).toBeGreaterThan(0);
    expect(await count(app)).toBe(0);
  });

  test(`a CSV with more than ${MAX_IMPORT_ROWS} rows answers 400 and adds nothing`, async () => {
    const app = createApp(":memory:");
    const res = await importCsv(app, "title\n" + "a\n".repeat(MAX_IMPORT_ROWS + 1));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("too_many_rows");
    expect(await count(app)).toBe(0);
  });

  test(`a JSON file with more than ${MAX_IMPORT_ROWS} items answers 400 and adds nothing`, async () => {
    const app = createApp(":memory:");
    const items = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ title: "a" }));
    const res = await importJson(app, { version: 1, items });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("too_many_rows");
    expect(await count(app)).toBe(0);
  });
});

describe("the real server caps request bodies", () => {
  let dir: string;
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  const port = 40000 + Math.floor(Math.random() * 10000);
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "shelf-limits-"));
    proc = Bun.spawn(["bun", "src/shelf/server.ts"], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, PORT: String(port), SHELF_DB: join(dir, "limits.db") },
      stdout: "ignore",
      stderr: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
      } catch {}
      await Bun.sleep(100);
    }
    throw new Error("server did not start");
  });
  afterAll(async () => {
    proc?.kill();
    await proc?.exited;
    rmSync(dir, { recursive: true, force: true });
  });

  test("a body over MAX_BODY_BYTES is refused and nothing is added", async () => {
    const big = "title\n" + "a".repeat(MAX_BODY_BYTES + 1024) + "\n";
    let status = 0;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/import?format=csv`, {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: big,
      });
      status = res.status;
    } catch {
      status = -1; // the server may close the connection instead of answering
    }
    expect(status === 413 || status === -1).toBe(true);
    const items = (await (await fetch(`http://127.0.0.1:${port}/api/items`)).json()) as unknown[];
    expect(items.length).toBe(0);
  }, 30000);
});
