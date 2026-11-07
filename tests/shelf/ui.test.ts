import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});

const get = (path: string) => app.fetch(new Request("http://x" + path));

const PUBLIC = join(import.meta.dir, "../../src/shelf/public");
const loadRender = async () => (await import("../../src/shelf/public/render.js")) as any;

describe("static files", () => {
  test("GET / answers 200 text/html with the add form, list container, app.js module and style.css", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/html");
    const html = await res.text();
    expect(html).toContain('<form id="add-form"');
    expect(html).toMatch(/id="items"/);
    expect(html).toContain('<script type="module" src="/app.js">');
    expect(html).toContain("/style.css");
  });

  test("/app.js and /render.js are served as text/javascript", async () => {
    for (const p of ["/app.js", "/render.js"]) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("text/javascript");
    }
  });

  test("/style.css is served as text/css", async () => {
    const res = await get("/style.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/css");
  });

  test("anything outside the fixed file list answers 404 with the API error shape", async () => {
    for (const p of ["/server.ts", "/../server.ts", "/%2e%2e/server.ts", "/public/app.js", "/nope.js"]) {
      const res = await get(p);
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      for (const key of ["code", "message", "fix"]) {
        expect(typeof body.error[key]).toBe("string");
      }
    }
  });

  test("POST / answers 404", async () => {
    const res = await app.fetch(new Request("http://x/", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  test("/api routes still work", async () => {
    expect((await get("/api/health")).status).toBe(200);
  });
});

describe("source checks", () => {
  test("no public file uses innerHTML, outerHTML, insertAdjacentHTML or document.write", () => {
    expect(existsSync(PUBLIC)).toBe(true);
    const files = readdirSync(PUBLIC);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(PUBLIC, f), "utf8");
      for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
        expect(src.includes(bad)).toBe(false);
      }
    }
  });
});

// Minimal fake DOM supporting exactly what render.js may use.
class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: (FakeNode | string)[] = [];
  listeners: Record<string, Function[]> = {};
  private own = "";
  [k: string]: any;
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...nodes: (FakeNode | string)[]) {
    this.children.push(...nodes);
  }
  setAttribute(n: string, v: string) {
    this.attrs[n] = String(v);
  }
  addEventListener(t: string, fn: Function) {
    (this.listeners[t] ||= []).push(fn);
  }
  set textContent(s: string) {
    this.own = String(s);
    this.children = [];
  }
  get textContent(): string {
    return this.own + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
}
const doc = { createElement: (tag: string) => new FakeNode(tag) };

const walk = (n: FakeNode | string, out: FakeNode[] = []): FakeNode[] => {
  if (typeof n === "string") return out;
  out.push(n);
  for (const c of n.children) walk(c, out);
  return out;
};
const field = (li: FakeNode, name: string) => walk(li).find((e) => e.attrs["data-field"] === name);

const mk = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Dune",
  author: "Frank Herbert",
  url: null,
  kind: "book",
  status: "to_read",
  rating: null,
  notes: null,
  tags: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  finished_at: null,
  ...over,
});

describe("safeHref", () => {
  test("rejects null, empty, javascript:, data:, ftp: and relative URLs", async () => {
    const { safeHref } = await loadRender();
    for (const u of [null, "", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "ftp://x", "/relative"]) {
      expect(safeHref(u)).toBeNull();
    }
  });
  test("returns http and https URLs unchanged", async () => {
    const { safeHref } = await loadRender();
    expect(safeHref("https://e.com/a?b=1")).toBe("https://e.com/a?b=1");
    expect(safeHref("http://e.com")).toBe("http://e.com");
  });
});

describe("renderItem", () => {
  test("returns an li", async () => {
    const { renderItem } = await loadRender();
    expect(renderItem(doc, mk(), {}).tag).toBe("li");
  });

  test("title is a safe link when the item has an http(s) url", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, mk({ url: "https://e.com/a?b=1" }), {});
    const t = field(li, "title")!;
    expect(t.tag).toBe("a");
    expect(t.attrs.href).toBe("https://e.com/a?b=1");
    expect(t.attrs.rel).toBe("noopener noreferrer");
    expect(t.attrs.target).toBe("_blank");
    expect(t.textContent).toBe("Dune");
  });

  test("title is not a link when there is no url", async () => {
    const { renderItem } = await loadRender();
    const t = field(renderItem(doc, mk(), {}), "title")!;
    expect(t.tag).not.toBe("a");
    expect(t.attrs.href).toBeUndefined();
    expect(t.textContent).toBe("Dune");
  });

  test("a javascript: url renders no anchor anywhere", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, mk({ url: "javascript:alert(1)" }), {});
    expect(walk(li).some((e) => e.tag === "a")).toBe(false);
    expect(walk(li).some((e) => "href" in e.attrs)).toBe(false);
  });

  test("an HTML-looking title shows as text and creates no img element", async () => {
    const { renderItem } = await loadRender();
    const title = "<img src=x onerror=alert(1)>";
    const li = renderItem(doc, mk({ title }), {});
    expect(field(li, "title")!.textContent).toBe(title);
    expect(walk(li).some((e) => e.tag === "img")).toBe(false);
  });

  test("non-Latin titles (Amharic, Japanese, emoji) round-trip as text", async () => {
    const { renderItem } = await loadRender();
    for (const title of ["የአማርኛ መጽሐፍ", "吾輩は猫である", "Books 📚🔥"]) {
      expect(field(renderItem(doc, mk({ title }), {}), "title")!.textContent).toBe(title);
    }
  });

  test("author is shown, and empty or absent when null", async () => {
    const { renderItem } = await loadRender();
    expect(field(renderItem(doc, mk(), {}), "author")!.textContent).toContain("Frank Herbert");
    const a = field(renderItem(doc, mk({ author: null }), {}), "author");
    expect(a === undefined || a.textContent === "").toBe(true);
  });

  test("kind, status and rating fields are present", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, mk({ kind: "article", status: "finished", rating: 4 }), {});
    expect(field(li, "kind")!.textContent).toContain("article");
    expect(field(li, "status")).toBeDefined();
    expect(field(li, "rating")).toBeDefined();
  });

  test("tags text contains each tag", async () => {
    const { renderItem } = await loadRender();
    const t = field(renderItem(doc, mk({ tags: ["scifi", "classic", "ተረት"] }), {}), "tags")!;
    for (const tag of ["scifi", "classic", "ተረት"]) expect(t.textContent).toContain(tag);
  });

  test("no element has an on* attribute, and actions may be omitted", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, mk({ url: "https://e.com", tags: ["a"], title: "<b onclick=x>" }));
    for (const e of walk(li)) {
      for (const name of Object.keys(e.attrs)) expect(name.startsWith("on")).toBe(false);
    }
  });
});

describe("renderList", () => {
  test("an empty list gives a single 'Nothing on your shelf yet' element", async () => {
    const { renderList } = await loadRender();
    const out = renderList(doc, [], {});
    expect(out).toHaveLength(1);
    expect(out[0].textContent).toBe("Nothing on your shelf yet");
  });

  test("items render one element each, in the given order", async () => {
    const { renderList } = await loadRender();
    const out = renderList(doc, [mk({ id: 2, title: "B" }), mk({ id: 1, title: "A" }), mk({ id: 3, title: "C" })], {});
    expect(out).toHaveLength(3);
    expect(out.map((li: FakeNode) => field(li, "title")!.textContent)).toEqual(["B", "A", "C"]);
  });
});
