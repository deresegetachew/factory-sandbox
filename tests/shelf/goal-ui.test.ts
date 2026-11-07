import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});
const get = (path: string) => app.fetch(new Request("http://x" + path));
const send = (method: string, path: string, body?: unknown) =>
  app.fetch(new Request("http://x" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const loadData = async () => (await import("../../src/shelf/public/data.js")) as any;
const loadRender = async () => (await import("../../src/shelf/public/render.js")) as any;

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
const attr = (n: FakeNode, name: string) => (n[name] !== undefined && typeof n[name] !== "function" ? n[name] : n.attrs[name]);
const cls = (n: FakeNode) => String(n.className ?? n.attrs["class"] ?? "");
const form = (root: FakeNode) => walk(root).find((n) => n.tag === "form")!;
const input = (root: FakeNode) => walk(root).find((n) => n.tag === "input")!;
const buttonByText = (root: FakeNode, text: string) => walk(root).find((n) => n.tag === "button" && n.textContent === text)!;
const errorBox = (root: FakeNode) => walk(root).find((n) => n.tag === "div" && /\berror\b/.test(cls(n)))!;
const submit = (root: FakeNode) => form(root).listeners["submit"][0]({ preventDefault() {} });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const isHidden = (n: FakeNode) => n.hidden === true || "hidden" in n.attrs;
const noop = { onSave: async () => null, onRemove: async () => null };

describe("goalView", () => {
  test("no goal gives the set mode with a label for the year", async () => {
    const { goalView } = await loadData();
    expect(goalView(null, 2026)).toEqual({ mode: "set", year: 2026, label: "Set a goal for 2026" });
  });

  test("a goal for another year gives the set mode for this year", async () => {
    const { goalView } = await loadData();
    expect(goalView({ year: 2025, books: 10, done: 3 }, 2026)).toEqual({ mode: "set", year: 2026, label: "Set a goal for 2026" });
  });

  test("progress shows done of books, value, max and percent", async () => {
    const { goalView } = await loadData();
    expect(goalView({ year: 2026, books: 24, done: 6 }, 2026)).toEqual({
      mode: "progress", year: 2026, books: 24, done: 6, text: "6 of 24 books in 2026", value: 6, max: 24, percent: 25,
    });
  });

  test("done beyond the goal keeps the text but caps value and percent", async () => {
    const { goalView } = await loadData();
    const v = goalView({ year: 2026, books: 24, done: 30 }, 2026);
    expect(v.text).toBe("30 of 24 books in 2026");
    expect(v.value).toBe(24);
    expect(v.max).toBe(24);
    expect(v.percent).toBe(100);
  });

  test("zero done is 0 percent", async () => {
    const { goalView } = await loadData();
    const v = goalView({ year: 2026, books: 24, done: 0 }, 2026);
    expect(v.percent).toBe(0);
    expect(v.value).toBe(0);
  });

  test("percent is rounded", async () => {
    const { goalView } = await loadData();
    expect(goalView({ year: 2026, books: 3, done: 1 }, 2026).percent).toBe(33);
  });
});

describe("goalBooks", () => {
  test.each([["24", 24], [" 7 ", 7], ["1", 1], ["1000", 1000]])("%p is accepted as %p", async (text, n) => {
    const { goalBooks } = await loadData();
    expect(goalBooks(text)).toEqual({ books: n });
  });

  test.each([[""], ["   "], ["0"], ["-3"], ["2.5"], ["abc"], ["1e2"], ["1001"], ["99999"]])("%p is refused with the rule in words", async (text) => {
    const { goalBooks } = await loadData();
    const r = goalBooks(text);
    expect(r.books).toBeUndefined();
    expect(typeof r.problem).toBe("string");
    expect(r.problem).toContain("whole number from 1 to 1000");
  });
});

describe("renderGoal in set mode", () => {
  const view = { mode: "set", year: 2026, label: "Set a goal for 2026" };

  test("a div.goal with data-goal=set holding a labelled number form and a hidden alert", async () => {
    const { renderGoal } = await loadRender();
    const root = renderGoal(doc, view, noop);
    expect(root.tag).toBe("div");
    expect(cls(root)).toContain("goal");
    expect(root.attrs["data-goal"]).toBe("set");
    expect(form(root).attrs["data-goal"]).toBe("form");
    expect(walk(root).find((n) => n.tag === "label")!.textContent).toContain("Set a goal for 2026");
    const i = input(root);
    expect(i.attrs["name"] ?? i.name).toBe("books");
    expect(String(attr(i, "type"))).toBe("number");
    expect(String(attr(i, "min"))).toBe("1");
    expect(String(attr(i, "max"))).toBe("1000");
    expect(String(attr(i, "step"))).toBe("1");
    const save = buttonByText(root, "Save");
    expect(save).toBeDefined();
    const e = errorBox(root);
    expect(e.attrs["role"]).toBe("alert");
    expect(isHidden(e)).toBe(true);
  });

  test("an invalid value shows the problem and sends nothing", async () => {
    const { renderGoal } = await loadRender();
    let n = 0;
    const root = renderGoal(doc, view, { ...noop, onSave: async () => (n++, null) });
    input(root).value = "2.5";
    await submit(root);
    expect(n).toBe(0);
    expect(errorBox(root).textContent).toContain("whole number from 1 to 1000");
    expect(errorBox(root).hidden).toBe(false);
  });

  test("a valid value calls onSave with the number", async () => {
    const { renderGoal } = await loadRender();
    const calls: unknown[] = [];
    const root = renderGoal(doc, view, { ...noop, onSave: async (b: unknown) => (calls.push(b), null) });
    input(root).value = " 24 ";
    await submit(root);
    expect(calls).toEqual([24]);
  });

  test("an error from onSave is shown", async () => {
    const { renderGoal } = await loadRender();
    const root = renderGoal(doc, view, { ...noop, onSave: async () => "Could not save" });
    input(root).value = "5";
    await submit(root);
    expect(errorBox(root).textContent).toBe("Could not save");
    expect(errorBox(root).hidden).toBe(false);
  });

  test("Save is disabled while pending, so a second submit sends nothing", async () => {
    const { renderGoal } = await loadRender();
    const d = deferred<string | null>();
    let n = 0;
    const root = renderGoal(doc, view, { ...noop, onSave: () => (n++, d.promise) });
    input(root).value = "5";
    const first = submit(root);
    expect(buttonByText(root, "Save").disabled).toBe(true);
    const second = submit(root);
    d.resolve(null);
    await Promise.all([first, second]);
    expect(n).toBe(1);
  });
});

describe("renderGoal in progress mode", () => {
  const view = { mode: "progress", year: 2026, books: 24, done: 6, text: "6 of 24 books in 2026", value: 6, max: 24, percent: 25 };

  test("shows the text, a progress element, Change and Remove buttons and a hidden prefilled form", async () => {
    const { renderGoal } = await loadRender();
    const root = renderGoal(doc, view, noop);
    expect(root.attrs["data-goal"]).toBe("progress");
    expect(walk(root).find((n) => n.tag === "p" && n.attrs["data-goal"] === "text")!.textContent).toBe("6 of 24 books in 2026");
    const p = walk(root).find((n) => n.tag === "progress")!;
    expect(Number(attr(p, "value"))).toBe(6);
    expect(Number(attr(p, "max"))).toBe(24);
    for (const t of ["Change", "Remove"]) {
      const b = buttonByText(root, t);
      expect(b).toBeDefined();
      expect(String(attr(b, "type"))).toBe("button");
    }
    expect(isHidden(form(root))).toBe(true);
    expect(String(input(root).value)).toBe("24");
    expect(isHidden(errorBox(root))).toBe(true);
  });

  test("Change shows the form", async () => {
    const { renderGoal } = await loadRender();
    const root = renderGoal(doc, view, noop);
    buttonByText(root, "Change").listeners["click"][0]({ preventDefault() {} });
    expect(form(root).hidden).toBe(false);
  });

  test("submitting a new value calls onSave with it", async () => {
    const { renderGoal } = await loadRender();
    const calls: unknown[] = [];
    const root = renderGoal(doc, view, { ...noop, onSave: async (b: unknown) => (calls.push(b), null) });
    input(root).value = "30";
    await submit(root);
    expect(calls).toEqual([30]);
  });

  test("Remove calls onRemove once", async () => {
    const { renderGoal } = await loadRender();
    let n = 0;
    const root = renderGoal(doc, view, { ...noop, onRemove: async () => (n++, null) });
    await buttonByText(root, "Remove").listeners["click"][0]({ preventDefault() {} });
    expect(n).toBe(1);
  });

  test("an error from onRemove is shown", async () => {
    const { renderGoal } = await loadRender();
    const root = renderGoal(doc, view, { ...noop, onRemove: async () => "Could not remove" });
    await buttonByText(root, "Remove").listeners["click"][0]({ preventDefault() {} });
    expect(errorBox(root).textContent).toBe("Could not remove");
    expect(errorBox(root).hidden).toBe(false);
  });
});

describe("goal UI against the API", () => {
  const year = new Date().getUTCFullYear();

  test("a goal and two finished books give '2 of 24 books in <year>'", async () => {
    const { goalView } = await loadData();
    expect((await send("PUT", `/api/goals/${year}`, { books: 24 })).status).toBe(200);
    for (const title of ["A", "B"]) {
      expect((await send("POST", "/api/items", { title, kind: "book", status: "done" })).status).toBe(201);
    }
    const stats = (await (await get("/api/stats")).json()) as any;
    const v = goalView(stats.goal, year);
    expect(v.mode).toBe("progress");
    expect(v.text).toBe(`2 of 24 books in ${year}`);
  });

  test("a goal for next year leaves this year in set mode", async () => {
    const { goalView } = await loadData();
    await send("PUT", `/api/goals/${year + 1}`, { books: 12 });
    const stats = (await (await get("/api/stats")).json()) as any;
    expect(goalView(stats.goal, year).mode).toBe("set");
  });

  test("the form refuses what the API refuses", async () => {
    const { goalBooks } = await loadData();
    for (const [text, books] of [["0", 0], ["2.5", 2.5]] as const) {
      expect(goalBooks(text).problem).toBeDefined();
      const res = await send("PUT", `/api/goals/${year}`, { books });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("invalid_books");
    }
    expect(goalBooks("").problem).toBeDefined();
  });
});
