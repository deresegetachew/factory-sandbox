import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});
const get = (path: string) => app.fetch(new Request("http://x" + path));
const send = (method: string, path: string, body?: unknown) =>
  app.fetch(new Request("http://x" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const loadRender = async () => (await import("../../src/shelf/public/render.js")) as any;

// Minimal fake DOM (copied from stats-ui.test.ts), plus remove() recording removed=true.
class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: (FakeNode | string)[] = [];
  listeners: Record<string, Function[]> = {};
  removed = false;
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
  remove() {
    this.removed = true;
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
const field = (li: FakeNode, name: string) => walk(li).filter((n) => n.attrs["data-field"] === name);
const button = (li: FakeNode) => walk(li).find((n) => n.tag === "button")!;
const errorBox = (li: FakeNode) => walk(li).find((n) => n.tag === "div" && /\berror\b/.test(String(n.className ?? n.attrs["class"] ?? "")))!;
const click = (li: FakeNode) => button(li).listeners["click"][0]({ preventDefault() {} });
const gone = (li: FakeNode) => li.removed === true || li.hidden === true;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const item = (id: number, title: string, author: string | null = "Someone") => ({ id, title, author, status: "reading" });

describe("renderReadingStrip", () => {
  test("no items gives an empty array", async () => {
    const { renderReadingStrip } = await loadRender();
    expect(renderReadingStrip(doc, [], async () => null)).toEqual([]);
  });

  test("two reading items give two li.reading-item entries in order, with title and author as text", async () => {
    const { renderReadingStrip } = await loadRender();
    const lis = renderReadingStrip(doc, [item(7, "Dune", "Frank Herbert"), item(9, "Emma", "Jane Austen")], async () => null);
    expect(lis.length).toBe(2);
    for (const li of lis) {
      expect(li.tag).toBe("li");
      expect(String(li.className ?? li.attrs["class"])).toContain("reading-item");
    }
    expect(String(lis[0].dataset?.id ?? lis[0].attrs["data-id"])).toBe("7");
    expect(String(lis[1].dataset?.id ?? lis[1].attrs["data-id"])).toBe("9");
    expect(field(lis[0], "title")[0].textContent).toBe("Dune");
    expect(field(lis[0], "author")[0].textContent).toBe("Frank Herbert");
    expect(field(lis[1], "title")[0].textContent).toBe("Emma");
  });

  test("a title with <b> shows the tags as text, not as an element", async () => {
    const { renderReadingStrip } = await loadRender();
    const [li] = renderReadingStrip(doc, [item(1, "<b>Bold</b> move")], async () => null);
    expect(walk(li).some((n) => n.tag === "b")).toBe(false);
    expect(field(li, "title")[0].textContent).toBe("<b>Bold</b> move");
  });

  test("the author is omitted when empty or missing", async () => {
    const { renderReadingStrip } = await loadRender();
    const lis = renderReadingStrip(doc, [item(1, "A", ""), item(2, "B", null)], async () => null);
    for (const li of lis) expect(field(li, "author").length).toBe(0);
  });

  test("the button is a real type=button labelled Finished with an accessible name including the title", async () => {
    const { renderReadingStrip } = await loadRender();
    const [li] = renderReadingStrip(doc, [item(1, "Dune")], async () => null);
    const b = button(li);
    expect(b.tag).toBe("button");
    expect(b.type === "button" || b.attrs["type"] === "button").toBe(true);
    expect(b.textContent).toBe("Finished");
    expect(b.attrs["aria-label"]).toBe("Finished: Dune");
  });

  test("an error area with role=alert starts hidden", async () => {
    const { renderReadingStrip } = await loadRender();
    const [li] = renderReadingStrip(doc, [item(1, "Dune")], async () => null);
    const e = errorBox(li);
    expect(e).toBeDefined();
    expect(e.attrs["role"]).toBe("alert");
    expect(e.hidden === true || "hidden" in e.attrs).toBe(true);
  });

  test("clicking Finished calls onFinished once with the item id, and on success removes the entry", async () => {
    const { renderReadingStrip } = await loadRender();
    const calls: unknown[] = [];
    const [li] = renderReadingStrip(doc, [item(42, "Dune")], async (id: unknown) => (calls.push(id), null));
    await click(li);
    expect(calls).toEqual([42]);
    expect(gone(li)).toBe(true);
  });

  test("on error the entry stays, the button is re-enabled and the message shows", async () => {
    const { renderReadingStrip } = await loadRender();
    const [li] = renderReadingStrip(doc, [item(1, "Dune")], async () => "Could not save");
    await click(li);
    expect(gone(li)).toBe(false);
    expect(button(li).disabled).toBe(false);
    const e = errorBox(li);
    expect(e.textContent).toBe("Could not save");
    expect(e.hidden).toBe(false);
  });

  test("a retry after an error can succeed", async () => {
    const { renderReadingStrip } = await loadRender();
    const replies: (string | null)[] = ["boom", null];
    const [li] = renderReadingStrip(doc, [item(1, "Dune")], async () => replies.shift() ?? null);
    await click(li);
    expect(gone(li)).toBe(false);
    await click(li);
    expect(gone(li)).toBe(true);
  });

  test("double click sends one request: the button is disabled while it runs", async () => {
    const { renderReadingStrip } = await loadRender();
    const d = deferred<string | null>();
    let n = 0;
    const [li] = renderReadingStrip(doc, [item(1, "Dune")], () => (n++, d.promise));
    const first = click(li);
    expect(button(li).disabled).toBe(true);
    const second = click(li);
    d.resolve(null);
    await Promise.all([first, second]);
    expect(n).toBe(1);
    expect(gone(li)).toBe(true);
  });

  test("20 reading items all render, each with its own button", async () => {
    const { renderReadingStrip } = await loadRender();
    const items = Array.from({ length: 20 }, (_, i) => item(i + 1, `Book ${i + 1}`));
    const lis = renderReadingStrip(doc, items, async () => null);
    expect(lis.length).toBe(20);
    expect(lis.map((li: FakeNode) => field(li, "title")[0].textContent)).toEqual(items.map((i) => i.title));
    expect(new Set(lis.map((li: FakeNode) => button(li).attrs["aria-label"])).size).toBe(20);
  });
});

describe("the API the strip uses", () => {
  test("PATCH status done takes the item out of status=reading and sets finished_at", async () => {
    const a = (await (await send("POST", "/api/items", { title: "A", status: "reading" })).json()) as any;
    const b = (await (await send("POST", "/api/items", { title: "B", status: "reading" })).json()) as any;
    const res = await send("PATCH", `/api/items/${a.id}`, { status: "done" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).finished_at).toBeTruthy();
    const list = (await (await get("/api/items?status=reading")).json()) as any;
    const rows = Array.isArray(list) ? list : list.items;
    expect(rows.map((r: any) => r.id)).toEqual([b.id]);
  });
});

describe("page markup and styles", () => {
  const html = readFileSync(new URL("../../src/shelf/public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../src/shelf/public/style.css", import.meta.url), "utf8");

  test("a hidden section#reading holds ul#reading-items and has an aria-labelledby heading", () => {
    const m = html.match(/<section\b[^>]*\bid="reading"[^>]*>([\s\S]*?)<\/section>/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/^<section\b[^>]*\bhidden\b/);
    expect(m![1]).toMatch(/<ul\b[^>]*\bid="reading-items"/);
    const labelled = m![0].match(/aria-labelledby="([^"]+)"/);
    expect(labelled).not.toBeNull();
    expect(m![1]).toMatch(new RegExp(`<h2\\b[^>]*\\bid="${labelled![1]}"`));
  });

  test("the strip comes before the Add an item section", () => {
    const reading = html.indexOf('id="reading"');
    const add = html.indexOf('id="add-heading"');
    expect(reading).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(-1);
    expect(reading).toBeLessThan(add);
  });

  test("the stylesheet lets the strip wrap or scroll on a phone", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => /#reading-items|\.reading-item/.test(sel));
    expect(rules.some(([, , body]) => /flex-wrap:\s*wrap|overflow-x:\s*(auto|scroll)/.test(body))).toBe(true);
  });
});
