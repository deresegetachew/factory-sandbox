import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});
const get = (path: string) => app.fetch(new Request("http://x" + path));

const loadFilters = async () => (await import("../../src/shelf/public/filters.js")) as any;
const loadRender = async () => (await import("../../src/shelf/public/render.js")) as any;

const EMPTY = { q: "", status: "", kind: "", tag: "", min_rating: "" };

// Minimal fake DOM (copied from ui.test.ts).
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
const optValue = (o: FakeNode) => (o.value !== undefined ? o.value : o.attrs.value);
const optSelected = (o: FakeNode) => o.selected === true || "selected" in o.attrs;

describe("filtersFromSearch", () => {
  test("FILTER_KEYS lists the five keys in order", async () => {
    const { FILTER_KEYS } = await loadFilters();
    expect(FILTER_KEYS).toEqual(["q", "status", "kind", "tag", "min_rating"]);
  });

  test("?q=dune&status=done fills q and status only", async () => {
    const { filtersFromSearch } = await loadFilters();
    expect(filtersFromSearch("?q=dune&status=done")).toEqual({ ...EMPTY, q: "dune", status: "done" });
  });

  test("works without the leading ?", async () => {
    const { filtersFromSearch } = await loadFilters();
    expect(filtersFromSearch("q=dune&kind=book")).toEqual({ ...EMPTY, q: "dune", kind: "book" });
  });

  test("an empty query string gives all-empty filters", async () => {
    const { filtersFromSearch } = await loadFilters();
    expect(filtersFromSearch("")).toEqual(EMPTY);
    expect(filtersFromSearch("?")).toEqual(EMPTY);
  });

  test("unknown keys are ignored", async () => {
    const { filtersFromSearch } = await loadFilters();
    const out = filtersFromSearch("?foo=bar&q=x");
    expect(out).toEqual({ ...EMPTY, q: "x" });
    expect(Object.keys(out).sort()).toEqual(["kind", "min_rating", "q", "status", "tag"]);
  });

  test("bad status, kind and min_rating become empty", async () => {
    const { filtersFromSearch } = await loadFilters();
    expect(filtersFromSearch("?status=maybe&min_rating=7&kind=film")).toEqual(EMPTY);
    expect(filtersFromSearch("?min_rating=0")).toEqual(EMPTY);
    expect(filtersFromSearch("?min_rating=abc")).toEqual(EMPTY);
  });

  test("every valid status, kind and min_rating is kept", async () => {
    const { filtersFromSearch } = await loadFilters();
    for (const s of ["to_read", "reading", "done"]) expect(filtersFromSearch(`?status=${s}`).status).toBe(s);
    for (const k of ["book", "article"]) expect(filtersFromSearch(`?kind=${k}`).kind).toBe(k);
    for (const r of ["1", "2", "3", "4", "5"]) expect(filtersFromSearch(`?min_rating=${r}`).min_rating).toBe(r);
  });

  test("values are decoded: + is a space and percent-escapes are decoded", async () => {
    const { filtersFromSearch } = await loadFilters();
    expect(filtersFromSearch("?q=a+b%20c%25").q).toBe("a b c%");
    expect(filtersFromSearch("?tag=sci%2Dfi").tag).toBe("sci-fi");
  });

  test("q is not trimmed", async () => {
    const { filtersFromSearch } = await loadFilters();
    expect(filtersFromSearch("?q=%20dune%20").q).toBe(" dune ");
  });
});

describe("filtersToSearch", () => {
  test("all-empty gives an empty string", async () => {
    const { filtersToSearch } = await loadFilters();
    expect(filtersToSearch(EMPTY)).toBe("");
  });

  test("a whitespace-only q is left out", async () => {
    const { filtersToSearch } = await loadFilters();
    expect(filtersToSearch({ ...EMPTY, q: "   " })).toBe("");
    expect(filtersToSearch({ ...EMPTY, q: "  ", status: "done" })).toBe("?status=done");
  });

  test("gives ? plus the non-empty pairs", async () => {
    const { filtersToSearch } = await loadFilters();
    expect(filtersToSearch({ ...EMPTY, q: "dune", status: "done" })).toBe("?q=dune&status=done");
  });

  test("pairs follow FILTER_KEYS order, not object order", async () => {
    const { filtersToSearch } = await loadFilters();
    expect(filtersToSearch({ tag: "sci-fi", status: "done" })).toBe("?status=done&tag=sci-fi");
    expect(filtersToSearch({ min_rating: "3", kind: "book", q: "x", tag: "t", status: "reading" })).toBe(
      "?q=x&status=reading&kind=book&tag=t&min_rating=3",
    );
  });

  test("round trip keeps awkward and non-Latin q values with valid other filters", async () => {
    const { filtersToSearch, filtersFromSearch } = await loadFilters();
    const qs = ['O\'Brien "x"', "%", "100% & more", "a+b", "#", "የአማርኛ መጽሐፍ", "吾輩は猫である", "Books 📚🔥"];
    for (const q of qs) {
      const f = { q, status: "reading", kind: "article", tag: "sci-fi", min_rating: "4" };
      expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
    }
  });

  test("round trip keeps awkward tags", async () => {
    const { filtersToSearch, filtersFromSearch } = await loadFilters();
    for (const tag of ["a&b", "100%", "ተረት", "日本語", "🔥"]) {
      const f = { ...EMPTY, tag };
      expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
    }
  });
});

describe("hasFilters and itemsPath", () => {
  test("hasFilters is false when all empty or q is whitespace, true otherwise", async () => {
    const { hasFilters } = await loadFilters();
    expect(hasFilters(EMPTY)).toBe(false);
    expect(hasFilters({ ...EMPTY, q: "  " })).toBe(false);
    expect(hasFilters({ ...EMPTY, q: "x" })).toBe(true);
    expect(hasFilters({ ...EMPTY, status: "done" })).toBe(true);
    expect(hasFilters({ ...EMPTY, kind: "book" })).toBe(true);
    expect(hasFilters({ ...EMPTY, tag: "t" })).toBe(true);
    expect(hasFilters({ ...EMPTY, min_rating: "2" })).toBe(true);
  });

  test("itemsPath is /api/items plus the search string", async () => {
    const { itemsPath } = await loadFilters();
    expect(itemsPath(EMPTY)).toBe("/api/items");
    expect(itemsPath({ ...EMPTY, q: "dune", status: "done" })).toBe("/api/items?q=dune&status=done");
    expect(itemsPath({ ...EMPTY, q: "100% & more" })).toBe("/api/items?q=100%25+%26+more");
  });
});

describe("renderList empty text", () => {
  test("uses the given emptyText", async () => {
    const { renderList } = await loadRender();
    const out = renderList(doc, [], {}, "No items match");
    expect(out).toHaveLength(1);
    expect(out[0].textContent).toBe("No items match");
  });

  test("defaults to 'Nothing on your shelf yet'", async () => {
    const { renderList } = await loadRender();
    expect(renderList(doc, [], {})[0].textContent).toBe("Nothing on your shelf yet");
  });
});

describe("renderTagOptions", () => {
  const tags = [
    { tag: "sci-fi", count: 3 },
    { tag: "history", count: 1 },
  ];

  test("first option is All tags with empty value, then one per tag in order with counts", async () => {
    const { renderTagOptions } = await loadRender();
    const out = renderTagOptions(doc, tags, "");
    expect(out.map((o: FakeNode) => o.tag)).toEqual(["option", "option", "option"]);
    expect(out.map((o: FakeNode) => o.textContent)).toEqual(["All tags", "sci-fi (3)", "history (1)"]);
    expect(out.map(optValue)).toEqual(["", "sci-fi", "history"]);
  });

  test("with no tags only All tags is returned", async () => {
    const { renderTagOptions } = await loadRender();
    const out = renderTagOptions(doc, [], "");
    expect(out).toHaveLength(1);
    expect(out[0].textContent).toBe("All tags");
  });

  test("only the selected tag's option is selected", async () => {
    const { renderTagOptions } = await loadRender();
    const out = renderTagOptions(doc, tags, "history");
    expect(out.map(optSelected)).toEqual([false, false, true]);
  });

  test("a selected tag missing from the list is added at the end with (0)", async () => {
    const { renderTagOptions } = await loadRender();
    const out = renderTagOptions(doc, tags, "ተረት");
    expect(out).toHaveLength(4);
    expect(out[3].textContent).toBe("ተረት (0)");
    expect(optValue(out[3])).toBe("ተረት");
    expect(optSelected(out[3])).toBe(true);
    expect(out.slice(0, 3).some(optSelected)).toBe(false);
  });

  test("tag text is set as text and creates no b element", async () => {
    const { renderTagOptions } = await loadRender();
    const out = renderTagOptions(doc, [{ tag: "<b>x</b>", count: 2 }], "");
    expect(out[1].textContent).toBe("<b>x</b> (2)");
    expect(out.flatMap((o: FakeNode) => walk(o)).some((e) => e.tag === "b")).toBe(false);
  });
});

describe("static files and page", () => {
  test("GET /filters.js is text/javascript with a content-security-policy header", async () => {
    const res = await get("/filters.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/javascript");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  test("GET / has the filters form with its fields and the clear button", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('<form id="filters"');
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"|<input[^>]*name="q"[^>]*type="search"/);
    for (const name of ["status", "kind", "tag", "min_rating"]) {
      expect(html).toMatch(new RegExp(`<(select|input)[^>]*name="${name}"`));
    }
    expect(html).toMatch(/<button[^>]*id="clear-filters"/);
  });
});
