import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/shelf/db";
import { createApp, serverOptions } from "../../src/shelf/server";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shelf-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const columns = (db: ReturnType<typeof openDb>, table: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("http", () => {
  test("GET /api/health returns 200 {ok:true}", async () => {
    const app = createApp(":memory:");
    const res = await app.fetch(new Request("http://x/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  for (const path of ["/api/nope", "/nothing"]) {
    test(`unknown route ${path} returns 404 with a code, message and fix`, async () => {
      const app = createApp(":memory:");
      const res = await app.fetch(new Request("http://x" + path));
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      for (const key of ["code", "message", "fix"]) {
        expect(typeof body.error[key]).toBe("string");
        expect(body.error[key].length).toBeGreaterThan(0);
      }
    });
  }
});

describe("schema", () => {
  test("a new file in an existing folder gets items and tags tables", () => {
    const db = openDb(join(dir, "new.db"));
    expect(columns(db, "items")).toEqual(
      expect.arrayContaining([
        "id", "title", "author", "url", "kind", "status", "rating", "notes",
        "created_at", "updated_at", "finished_at",
      ]),
    );
    expect(columns(db, "tags")).toEqual(expect.arrayContaining(["item_id", "tag"]));
    db.close();
  });

  test(":memory: works and has the schema", () => {
    const db = openDb(":memory:");
    expect(columns(db, "items").length).toBeGreaterThan(0);
    expect(columns(db, "tags").length).toBeGreaterThan(0);
  });

  test("opening the same file twice keeps existing data", () => {
    const file = join(dir, "twice.db");
    const first = openDb(file);
    first.run("INSERT INTO items (title) VALUES ('Dune')");
    first.close();
    const second = openDb(file);
    const rows = second.query("SELECT title FROM items").all() as { title: string }[];
    expect(rows.map((r) => r.title)).toEqual(["Dune"]);
    second.close();
  });

  test("the same tag twice on one item is rejected", () => {
    const db = openDb(":memory:");
    db.run("INSERT INTO items (title) VALUES ('Dune')");
    const id = (db.query("SELECT id FROM items").get() as { id: number }).id;
    db.run("INSERT INTO tags (item_id, tag) VALUES (?, 'scifi')", [id]);
    expect(() => db.run("INSERT INTO tags (item_id, tag) VALUES (?, 'scifi')", [id])).toThrow();
    db.run("INSERT INTO tags (item_id, tag) VALUES (?, 'classic')", [id]);
  });
});

describe("serverOptions", () => {
  test("defaults to 127.0.0.1, port 3000, shelf.db", () => {
    expect(serverOptions({})).toEqual({ hostname: "127.0.0.1", port: 3000, dbPath: "shelf.db" });
  });

  test("PORT and SHELF_DB override the defaults", () => {
    expect(serverOptions({ PORT: "4321", SHELF_DB: "/tmp/x.db" })).toEqual({
      hostname: "127.0.0.1",
      port: 4321,
      dbPath: "/tmp/x.db",
    });
  });
});

describe("running the server", () => {
  test("starts on 127.0.0.1, serves health, and survives a restart on the same db", async () => {
    const file = join(dir, "run.db");
    const port = 40000 + Math.floor(Math.random() * 10000);
    const start = async () => {
      const proc = Bun.spawn(["bun", "src/shelf/server.ts"], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, PORT: String(port), SHELF_DB: file },
        stdout: "ignore",
        stderr: "ignore",
      });
      for (let i = 0; i < 50; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          if (res.status === 200) return proc;
        } catch {}
        await Bun.sleep(100);
      }
      proc.kill();
      throw new Error("server did not answer /api/health");
    };
    const stop = async (p: Awaited<ReturnType<typeof start>>) => {
      p.kill();
      await p.exited;
    };

    const a = await start();
    await stop(a);
    const db = openDb(file);
    db.run("INSERT INTO items (title) VALUES ('Kept')");
    db.close();

    const b = await start();
    await stop(b);
    const check = openDb(file);
    expect(check.query("SELECT title FROM items").all()).toEqual([{ title: "Kept" }]);
    check.close();
  }, 20000);
});
