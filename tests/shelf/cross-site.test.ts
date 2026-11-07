import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/shelf/server";

type App = ReturnType<typeof createApp>;
const HOST = "127.0.0.1:3000";
const JSON_CT = "application/json";

const send = (app: App, method: string, path: string, headers: Record<string, string>, body?: string) =>
  app.fetch(new Request("http://x" + path, { method, headers, body }));

const list = async (app: App) => (await (await send(app, "GET", "/api/items", {})).json()) as any[];

const seed = async (app: App) => {
  const res = await send(app, "POST", "/api/items", { "content-type": JSON_CT }, JSON.stringify({ title: "Dune" }));
  expect(res.status).toBe(201);
  return (await res.json()) as any;
};

const expectRefusal = async (res: Response, status: number, code: string) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as any;
  expect(body.error.code).toBe(code);
  for (const key of ["code", "message", "fix"]) {
    expect(typeof body.error[key]).toBe("string");
    expect(body.error[key].length).toBeGreaterThan(0);
  }
};

const post = (app: App, headers: Record<string, string>) =>
  send(app, "POST", "/api/items", headers, JSON.stringify({ title: "New" }));

describe("Content-Type on writes", () => {
  const bad: [string, Record<string, string>][] = [
    ["text/plain", { "content-type": "text/plain" }],
    ["missing", {}],
    ["application/x-www-form-urlencoded", { "content-type": "application/x-www-form-urlencoded" }],
    ["multipart/form-data", { "content-type": "multipart/form-data; boundary=x" }],
    ["text/csv", { "content-type": "text/csv" }],
  ];
  for (const [name, headers] of bad) {
    test(`POST /api/items with ${name} answers 415 and adds nothing`, async () => {
      const app = createApp(":memory:");
      await expectRefusal(await post(app, headers), 415, "unsupported_media_type");
      expect(await list(app)).toEqual([]);
    });
  }

  test("PATCH with text/plain answers 415 and the item is unchanged", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    const res = await send(app, "PATCH", `/api/items/${item.id}`, { "content-type": "text/plain" }, JSON.stringify({ title: "Changed" }));
    await expectRefusal(res, 415, "unsupported_media_type");
    const after = await send(app, "GET", `/api/items/${item.id}`, {});
    expect(await after.json()).toEqual(item);
  });

  test("PATCH with no Content-Type answers 415", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    const res = await send(app, "PATCH", `/api/items/${item.id}`, {}, JSON.stringify({ title: "Changed" }));
    await expectRefusal(res, 415, "unsupported_media_type");
  });

  test("PUT with text/plain answers 415", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    const res = await send(app, "PUT", `/api/items/${item.id}`, { "content-type": "text/plain" }, "{}");
    await expectRefusal(res, 415, "unsupported_media_type");
  });

  test("application/json with charset, in any case, is accepted", async () => {
    const app = createApp(":memory:");
    expect((await post(app, { "content-type": "application/json; charset=utf-8" })).status).toBe(201);
    expect((await post(app, { "content-type": "Application/JSON; charset=UTF-8" })).status).toBe(201);
  });

  test("DELETE and GET need no Content-Type", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    expect((await send(app, "GET", "/api/items", {})).status).toBe(200);
    expect((await send(app, "DELETE", `/api/items/${item.id}`, {})).status).toBeLessThan(300);
  });
});

describe("Origin on writes", () => {
  const foreign = ["http://evil.example", "null", "https://127.0.0.1:3000", "http://127.0.0.1:3001"];
  for (const origin of foreign) {
    test(`POST with Origin ${origin} answers 403 cross_origin and adds nothing`, async () => {
      const app = createApp(":memory:");
      const res = await post(app, { host: HOST, origin, "content-type": JSON_CT });
      await expectRefusal(res, 403, "cross_origin");
      expect(await list(app)).toEqual([]);
    });
  }

  test("PATCH with a foreign Origin answers 403 and the item is unchanged", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    const res = await send(app, "PATCH", `/api/items/${item.id}`, { origin: "http://evil.example", "content-type": JSON_CT }, JSON.stringify({ title: "Changed" }));
    await expectRefusal(res, 403, "cross_origin");
    const after = await send(app, "GET", `/api/items/${item.id}`, {});
    expect(await after.json()).toEqual(item);
  });

  test("DELETE with a foreign Origin answers 403 and the item stays", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    const res = await send(app, "DELETE", `/api/items/${item.id}`, { origin: "http://evil.example" });
    await expectRefusal(res, 403, "cross_origin");
    expect((await send(app, "GET", `/api/items/${item.id}`, {})).status).toBe(200);
  });

  test("PUT with a foreign Origin answers 403", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    const res = await send(app, "PUT", `/api/items/${item.id}`, { origin: "http://evil.example", "content-type": JSON_CT }, "{}");
    await expectRefusal(res, 403, "cross_origin");
  });

  test("GET with a foreign Origin is not refused", async () => {
    const app = createApp(":memory:");
    const res = await send(app, "GET", "/api/items", { host: HOST, origin: "http://evil.example" });
    expect(res.status).toBe(200);
  });

  test("the app's own Origin, in any case, and no Origin are accepted", async () => {
    const app = createApp(":memory:");
    expect((await post(app, { host: HOST, origin: "http://127.0.0.1:3000", "content-type": JSON_CT })).status).toBe(201);
    expect((await post(app, { host: "localhost:3000", origin: "http://localhost:3000", "content-type": JSON_CT })).status).toBe(201);
    expect((await post(app, { host: HOST, origin: "HTTP://LOCALHOST:3000", "content-type": JSON_CT })).status).toBe(201);
    expect((await post(app, { "content-type": JSON_CT })).status).toBe(201);
  });

  test("allowed Host, Origin and charset together answer 201", async () => {
    const app = createApp(":memory:");
    const res = await post(app, { host: HOST, origin: "http://127.0.0.1:3000", "content-type": "application/json; charset=utf-8" });
    expect(res.status).toBe(201);
  });
});

describe("Host on /api", () => {
  test("GET with Host evil.example:3000 answers 403 wrong_host", async () => {
    const app = createApp(":memory:");
    await expectRefusal(await send(app, "GET", "/api/items", { host: "evil.example:3000" }), 403, "wrong_host");
  });

  test("POST with a foreign Host answers 403 and adds nothing", async () => {
    const app = createApp(":memory:");
    await expectRefusal(await post(app, { host: "evil.example:3000", "content-type": JSON_CT }), 403, "wrong_host");
    expect(await list(app)).toEqual([]);
  });

  test("DELETE with a foreign Host answers 403 and the item stays", async () => {
    const app = createApp(":memory:");
    const item = await seed(app);
    await expectRefusal(await send(app, "DELETE", `/api/items/${item.id}`, { host: "evil.example:3000" }), 403, "wrong_host");
    expect((await send(app, "GET", `/api/items/${item.id}`, {})).status).toBe(200);
  });

  test("Host in another case is accepted", async () => {
    const app = createApp(":memory:");
    expect((await send(app, "GET", "/api/items", { host: "LOCALHOST:3000" })).status).toBe(200);
  });

  test("localhost:3000 and 127.0.0.1:3000 are accepted", async () => {
    const app = createApp(":memory:");
    expect((await send(app, "GET", "/api/items", { host: "localhost:3000" })).status).toBe(200);
    expect((await send(app, "GET", "/api/items", { host: HOST })).status).toBe(200);
  });

  test("a Host with no port is refused", async () => {
    const app = createApp(":memory:");
    await expectRefusal(await send(app, "GET", "/api/items", { host: "localhost" }), 403, "wrong_host");
  });

  test("a different port is refused", async () => {
    const app = createApp(":memory:");
    await expectRefusal(await send(app, "GET", "/api/items", { host: "127.0.0.1:3001" }), 403, "wrong_host");
  });

  test("custom hosts option: its port is accepted and the default port is refused", async () => {
    const app = createApp(":memory:", { hosts: ["127.0.0.1:4321", "localhost:4321"] });
    expect((await send(app, "GET", "/api/items", { host: "127.0.0.1:4321" })).status).toBe(200);
    await expectRefusal(await send(app, "GET", "/api/items", { host: "127.0.0.1:3000" }), 403, "wrong_host");
  });

  test("custom hosts option: Origin is checked against the custom hosts", async () => {
    const app = createApp(":memory:", { hosts: ["127.0.0.1:4321", "localhost:4321"] });
    const ok = await post(app, { host: "127.0.0.1:4321", origin: "http://127.0.0.1:4321", "content-type": JSON_CT });
    expect(ok.status).toBe(201);
    const bad = await post(app, { host: "127.0.0.1:4321", origin: "http://127.0.0.1:3000", "content-type": JSON_CT });
    await expectRefusal(bad, 403, "cross_origin");
  });

  test("no Host header is allowed", async () => {
    const app = createApp(":memory:");
    expect((await send(app, "GET", "/api/items", {})).status).toBe(200);
  });

  test("static files answer 200", async () => {
    const app = createApp(":memory:");
    expect((await send(app, "GET", "/", {})).status).toBe(200);
    expect((await send(app, "GET", "/app.js", {})).status).toBe(200);
  });
});

describe("check order", () => {
  test("Host is checked before Origin and Content-Type", async () => {
    const app = createApp(":memory:");
    const res = await post(app, { host: "evil.example:3000", origin: "http://evil.example", "content-type": "text/plain" });
    await expectRefusal(res, 403, "wrong_host");
  });

  test("Origin is checked before Content-Type", async () => {
    const app = createApp(":memory:");
    const res = await post(app, { host: HOST, origin: "http://evil.example", "content-type": "text/plain" });
    await expectRefusal(res, 403, "cross_origin");
  });

  test("Content-Type is checked last", async () => {
    const app = createApp(":memory:");
    const res = await post(app, { host: HOST, origin: "http://127.0.0.1:3000", "content-type": "text/plain" });
    await expectRefusal(res, 415, "unsupported_media_type");
  });
});

describe("real server", () => {
  test("binds its port into the Host and Origin checks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shelf-xsite-"));
    const port = 40000 + Math.floor(Math.random() * 10000);
    const proc = Bun.spawn(["bun", "src/shelf/server.ts"], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, PORT: String(port), SHELF_DB: join(dir, "x.db") },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        try {
          up = (await fetch(`${base}/api/health`)).status === 200;
        } catch {}
        if (!up) await Bun.sleep(100);
      }
      expect(up).toBe(true);

      const body = JSON.stringify({ title: "Real" });
      const headers = { "content-type": JSON_CT };
      expect((await fetch(`${base}/api/items`, { method: "POST", headers, body })).status).toBe(201);
      expect(
        (await fetch(`${base}/api/items`, { method: "POST", headers: { ...headers, origin: "http://evil.example" }, body })).status,
      ).toBe(403);
      expect(
        (await fetch(`${base}/api/items`, { method: "POST", headers: { ...headers, origin: base }, body })).status,
      ).toBe(201);
      // Bun's fetch lets the Host header be overridden; if it ever stops, this assertion is the one to drop.
      expect((await fetch(`${base}/api/items`, { headers: { host: `evil.example:${port}` } })).status).toBe(403);
      const items = (await (await fetch(`${base}/api/items`)).json()) as any[];
      expect(items.length).toBe(2);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 20000);
});
