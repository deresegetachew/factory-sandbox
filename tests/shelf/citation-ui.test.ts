import { describe, expect, test } from "bun:test";

const loadRender = async () => (await import("../../src/shelf/public/render.js")) as any;

// Minimal fake DOM (copied from reading-strip-ui.test.ts), plus select() recording selected=true.
class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: (FakeNode | string)[] = [];
  listeners: Record<string, Function[]> = {};
  selected = false;
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
  select() {
    this.selected = true;
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
const COPY = "Copy as citation";
const copyButtons = (li: FakeNode) => walk(li).filter((n) => n.tag === "button" && (n.textContent === COPY || n.textContent === "Copied"));
const copyButton = (li: FakeNode) => copyButtons(li)[0];
const click = (li: FakeNode, b = copyButton(li)) => b.listeners["click"][0]({ preventDefault() {} });
const citationInputs = (li: FakeNode) => walk(li).filter((n) => n.tag === "input" && n.attrs["data-field"] === "citation");
const isReadOnly = (n: FakeNode) => n.readOnly === true || "readonly" in n.attrs;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = { id: 1, title: "Dune", author: "Frank Herbert", url: "https://example.com/dune", kind: "book", status: "to_read", tags: [] };
const make = (over: Record<string, unknown> = {}) => ({ ...base, ...over });

function recorder() {
  const calls: string[] = [];
  return { calls, clipboard: { writeText: async (s: string) => void calls.push(s) } };
}

describe("citation(item)", () => {
  test("author, title and url give 'Author, Title (URL)'", async () => {
    const { citation } = await loadRender();
    expect(citation(make())).toBe("Frank Herbert, Dune (https://example.com/dune)");
  });

  test("no author gives 'Title (URL)'", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ author: null }))).toBe("Dune (https://example.com/dune)");
  });

  test("no url gives 'Author, Title'", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ url: null }))).toBe("Frank Herbert, Dune");
  });

  test("neither author nor url gives just the title", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ author: null, url: null }))).toBe("Dune");
  });

  test("undefined and empty author/url count as missing", async () => {
    const { citation } = await loadRender();
    expect(citation({ title: "Dune" })).toBe("Dune");
    expect(citation(make({ author: "", url: "" }))).toBe("Dune");
  });

  test("whitespace-only author and url count as missing", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ author: "   ", url: " \t " }))).toBe("Dune");
    expect(citation(make({ author: "  ", url: "https://a.b" }))).toBe("Dune (https://a.b)");
    expect(citation(make({ author: "A", url: "\n" }))).toBe("A, Dune");
  });

  test("fields are trimmed", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ title: "  Dune ", author: " Frank Herbert  ", url: "  https://a.b " }))).toBe("Frank Herbert, Dune (https://a.b)");
  });

  test("commas, quotes, < and & are copied exactly as typed", async () => {
    const { citation } = await loadRender();
    const title = `Hello, "World" <i> & more`;
    expect(citation(make({ title, author: `O"Brien, Pat`, url: "https://a.b/?x=1&y=2" }))).toBe(
      `O"Brien, Pat, ${title} (https://a.b/?x=1&y=2)`,
    );
  });

  test("Amharic and emoji are copied unchanged", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ title: "ፍቅር እስከ መቃብር", author: "ሐዲስ ዓለማየሁ", url: null }))).toBe("ሐዲስ ዓለማየሁ, ፍቅር እስከ መቃብር");
    expect(citation(make({ title: "Dune 📚🚀", author: null, url: null }))).toBe("Dune 📚🚀");
  });

  test("a url that is not http or https is still included as typed", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ author: null, url: "ftp://x" }))).toBe("Dune (ftp://x)");
    expect(citation(make({ author: null, url: "not a url" }))).toBe("Dune (not a url)");
  });

  test("a very long title is copied whole", async () => {
    const { citation } = await loadRender();
    const title = "x".repeat(5000);
    expect(citation(make({ author: null, url: null, title }))).toBe(title);
  });

  test("a title with HTML is kept literally", async () => {
    const { citation } = await loadRender();
    expect(citation(make({ title: "<b>x</b>", author: null, url: null }))).toBe("<b>x</b>");
  });
});

describe("Copy as citation button", () => {
  test("renderItem gives each row one type=button labelled 'Copy as citation'", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, make(), {});
    const bs = copyButtons(li);
    expect(bs.length).toBe(1);
    expect(bs[0].type === "button" || bs[0].attrs["type"] === "button").toBe(true);
    expect(bs[0].textContent).toBe(COPY);
  });

  test("renderList renders one such button per item", async () => {
    const { renderList } = await loadRender();
    const lis = renderList(doc, [make({ id: 1 }), make({ id: 2 }), make({ id: 3 })], {});
    expect(lis.length).toBe(3);
    for (const li of lis) expect(copyButtons(li).length).toBe(1);
  });

  test("before any click there is no visible citation input", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, make(), recorderActions());
    for (const i of citationInputs(li)) expect(i.hidden === true || "hidden" in i.attrs).toBe(true);
  });

  test("clicking calls writeText exactly once with the citation line", async () => {
    const { renderItem, citation } = await loadRender();
    const r = recorder();
    const it = make();
    const li = renderItem(doc, it, { clipboard: r.clipboard, copiedMs: 10 });
    await click(li);
    expect(r.calls).toEqual([citation(it)]);
    expect(r.calls[0]).toBe("Frank Herbert, Dune (https://example.com/dune)");
  });

  test("on success the button says Copied, then goes back after copiedMs", async () => {
    const { renderItem } = await loadRender();
    const r = recorder();
    const li = renderItem(doc, make(), { clipboard: r.clipboard, copiedMs: 10 });
    const b = copyButton(li);
    await click(li, b);
    expect(b.textContent).toBe("Copied");
    await sleep(40);
    expect(b.textContent).toBe(COPY);
  });

  test("on success no fallback input appears", async () => {
    const { renderItem } = await loadRender();
    const r = recorder();
    const li = renderItem(doc, make(), { clipboard: r.clipboard, copiedMs: 10 });
    await click(li);
    for (const i of citationInputs(li)) expect(i.hidden === true || "hidden" in i.attrs).toBe(true);
  });

  test("text with HTML is never parsed: no b element, and the line is literal", async () => {
    const { renderItem } = await loadRender();
    const r = recorder();
    const li = renderItem(doc, make({ title: "<b>x</b>", author: null, url: null }), { clipboard: r.clipboard, copiedMs: 10 });
    await click(li);
    expect(walk(li).some((n) => n.tag === "b")).toBe(false);
    expect(r.calls).toEqual(["<b>x</b>"]);
  });

  test("with no actions.clipboard it uses navigator.clipboard", async () => {
    const { renderItem } = await loadRender();
    const r = recorder();
    const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: r.clipboard }, configurable: true, writable: true });
    try {
      const li = renderItem(doc, make(), { copiedMs: 10 });
      await click(li);
      expect(r.calls).toEqual(["Frank Herbert, Dune (https://example.com/dune)"]);
    } finally {
      if (saved) Object.defineProperty(globalThis, "navigator", saved);
      else delete (globalThis as any).navigator;
    }
  });
});

function recorderActions() {
  return { clipboard: recorder().clipboard, copiedMs: 10 };
}

describe("Copy as citation fallback", () => {
  const cases: [string, () => any][] = [
    ["a clipboard without writeText", () => ({ clipboard: {}, copiedMs: 10 })],
    ["writeText rejecting", () => ({ clipboard: { writeText: () => Promise.reject(new Error("denied")) }, copiedMs: 10 })],
    ["writeText throwing synchronously", () => ({ clipboard: { writeText: () => { throw new Error("nope"); } }, copiedMs: 10 })],
    ["no clipboard at all (null)", () => ({ clipboard: null, copiedMs: 10 })],
  ];

  for (const [name, actions] of cases) {
    test(`${name}: a read-only input with the line appears, selected, and the click resolves`, async () => {
      const { renderItem } = await loadRender();
      const li = renderItem(doc, make(), actions());
      expect(citationInputs(li).every((i) => i.hidden === true || "hidden" in i.attrs)).toBe(true);
      const b = copyButton(li);
      await click(li, b);
      const inputs = citationInputs(li);
      expect(inputs.length).toBe(1);
      const input = inputs[0];
      expect(isReadOnly(input)).toBe(true);
      expect(input.value).toBe("Frank Herbert, Dune (https://example.com/dune)");
      expect(input.hidden).not.toBe(true);
      expect("hidden" in input.attrs).toBe(false);
      expect(input.selected).toBe(true);
      expect(b.textContent).not.toBe("Copied");
      await sleep(30);
      expect(b.textContent).not.toBe("Copied");
    });
  }

  test("with null clipboard it does not fall back to navigator.clipboard", async () => {
    const { renderItem } = await loadRender();
    const r = recorder();
    const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: r.clipboard }, configurable: true, writable: true });
    try {
      const li = renderItem(doc, make(), { clipboard: null, copiedMs: 10 });
      await click(li);
      expect(r.calls).toEqual([]);
      expect(citationInputs(li).length).toBe(1);
    } finally {
      if (saved) Object.defineProperty(globalThis, "navigator", saved);
      else delete (globalThis as any).navigator;
    }
  });

  test("the fallback input holds the HTML text literally and creates no element from it", async () => {
    const { renderItem } = await loadRender();
    const li = renderItem(doc, make({ title: "<b>x</b>", author: null, url: null }), { clipboard: null });
    await click(li);
    expect(citationInputs(li)[0].value).toBe("<b>x</b>");
    expect(walk(li).some((n) => n.tag === "b")).toBe(false);
  });
});
