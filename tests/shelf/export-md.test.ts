import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";
import { escapeMarkdown, toMarkdown } from "../../src/shelf/export";

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

const exportMd = async () => {
  const res = await call("GET", "/api/export?format=md");
  expect(res.status).toBe(200);
  return await res.text();
};

const today = () => new Date().toISOString().slice(0, 10);

describe("GET /api/export?format=md", () => {
  test("answers 200 text/markdown in UTF-8 with an attachment name shelf-<today>.md", async () => {
    const res = await call("GET", "/api/export?format=md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="shelf-${today()}.md"`);
  });

  test("a fixed shelf is exported as three groups in order, oldest first, with links, authors, stars and tags", async () => {
    await create({ title: "Dune", author: "Frank Herbert", url: "https://example.com/d", status: "done", rating: 4, tags: ["sci-fi", "classic"] });
    await create({ title: "Plain title", status: "to_read" });
    await create({ title: "Neuromancer", author: "William Gibson", status: "reading", rating: 1 });
    await create({ title: "Hyperion", status: "to_read", rating: 5, tags: ["space"] });
    await create({ title: "Emma", author: "Jane Austen", status: "done", rating: 2 });
    await create({ title: "Ubik", url: "https://example.com/u", status: "reading", rating: 3, tags: ["pkd"] });
    expect(await exportMd()).toBe(
      [
        "# Shelf",
        "",
        "## Reading",
        "",
        "- Neuromancer by William Gibson · ★☆☆☆☆",
        "- [Ubik](https://example.com/u) · ★★★☆☆ · tags: pkd",
        "",
        "## To read",
        "",
        "- Plain title",
        "- Hyperion · ★★★★★ · tags: space",
        "",
        "## Done",
        "",
        "- [Dune](https://example.com/d) by Frank Herbert · ★★★★☆ · tags: classic, sci-fi",
        "- Emma by Jane Austen · ★★☆☆☆",
        "",
      ].join("\n"),
    );
  });

  test("an empty group is left out", async () => {
    await create({ title: "B", status: "done" });
    await create({ title: "A", status: "to_read" });
    const body = await exportMd();
    expect(body).not.toContain("## Reading");
    expect(body).toBe("# Shelf\n\n## To read\n\n- A\n\n## Done\n\n- B\n");
  });

  test("an empty shelf says so", async () => {
    expect(await exportMd()).toBe("# Shelf\n\nYour shelf is empty.\n");
  });

  test("notes never appear, however long", async () => {
    const marker = "NOTEMARKER".repeat(500);
    await create({ title: "With notes", notes: marker });
    const body = await exportMd();
    expect(body).toContain("With notes");
    expect(body).not.toContain("NOTEMARKER");
  });

  test("markdown characters in a title and author are escaped in the body", async () => {
    await create({ title: "*Not* [a link](x) `c` #1 <b> a|b", author: "_Anon_ ~ & !" });
    const body = await exportMd();
    expect(body).toContain("- \\*Not\\* \\[a link\\]\\(x\\) \\`c\\` \\#1 \\<b\\> a\\|b by \\_Anon\\_ \\~ \\& \\!\n");
  });

  test("a line break in a title becomes a space", async () => {
    await create({ title: "Two\nlines", author: "A\r\nB" });
    expect(await exportMd()).toContain("- Two lines by A B\n");
  });

  test("a URL's ) and ( are percent-encoded so the link does not break", async () => {
    await create({ title: "Dune", url: "https://en.wikipedia.org/wiki/Dune_(novel)" });
    expect(await exportMd()).toContain("- [Dune](https://en.wikipedia.org/wiki/Dune_%28novel%29)\n");
  });

  test("a space in a URL is percent-encoded as %20", async () => {
    // new URL() accepts a space inside the path, so the API stores it as given.
    await create({ title: "Spacey", url: "https://example.com/a b" });
    expect(await exportMd()).toContain("- [Spacey](https://example.com/a%20b)\n");
  });

  test("Amharic and emoji pass through unchanged", async () => {
    await create({ title: "Dune 😀", author: "ሃይሌ ገብረሥላሴ" });
    expect(await exportMd()).toContain("- Dune 😀 by ሃይሌ ገብረሥላሴ\n");
  });

  test("an unknown format answers 400 and the error names json, csv and md", async () => {
    const res = await call("GET", "/api/export?format=xml");
    expect(res.status).toBe(400);
    const err = ((await res.json()) as any).error;
    const text = `${err.message} ${err.fix}`;
    expect(text).toContain("json");
    expect(text).toContain("csv");
    expect(text).toContain("md");
  });
});

describe("escapeMarkdown", () => {
  test("escapes * _ [ ] ( ) ` # < > | ! ~ & and backslash", () => {
    expect(escapeMarkdown("*Not* [a link](x)")).toBe("\\*Not\\* \\[a link\\]\\(x\\)");
    expect(escapeMarkdown("a_b `c` #d <e> f|g h!i ~j &k \\l")).toBe(
      "a\\_b \\`c\\` \\#d \\<e\\> f\\|g h\\!i \\~j \\&k \\\\l",
    );
  });

  test("replaces \\r\\n, \\n and \\r each with a single space", () => {
    expect(escapeMarkdown("a\r\nb\nc\rd")).toBe("a b c d");
  });

  test("escapes a leading - + or =", () => {
    expect(escapeMarkdown("- item")).toBe("\\- item");
    expect(escapeMarkdown("+ item")).toBe("\\+ item");
    expect(escapeMarkdown("= item")).toBe("\\= item");
  });

  test("leaves - + = alone when not leading", () => {
    expect(escapeMarkdown("sci-fi a+b c=d")).toBe("sci-fi a+b c=d");
  });

  test("escapes the . or ) of a leading number", () => {
    expect(escapeMarkdown("1. Dune")).toBe("1\\. Dune");
    expect(escapeMarkdown("1984. A novel")).toBe("1984\\. A novel");
    expect(escapeMarkdown("12) Dune")).toBe("12\\) Dune");
  });

  test("leaves ordinary text, Amharic and emoji unchanged", () => {
    expect(escapeMarkdown("Plain title, with 3.5 stars")).toBe("Plain title, with 3.5 stars");
    expect(escapeMarkdown("ሃይሌ ገብረሥላሴ")).toBe("ሃይሌ ገብረሥላሴ");
    expect(escapeMarkdown("Dune 😀")).toBe("Dune 😀");
  });
});

describe("toMarkdown", () => {
  const item = (over: Record<string, unknown>) =>
    ({
      id: 1,
      title: "T",
      author: null,
      url: null,
      kind: "book",
      status: "to_read",
      rating: null,
      notes: null,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
      finished_at: null,
      tags: [],
      ...over,
    }) as any;

  test("an empty list gives the empty-shelf text", () => {
    expect(toMarkdown([])).toBe("# Shelf\n\nYour shelf is empty.\n");
  });

  test("a bare item is a single list line", () => {
    expect(toMarkdown([item({})])).toBe("# Shelf\n\n## To read\n\n- T\n");
  });

  test("the example line with url, author, stars and escaped tags", () => {
    const md = toMarkdown([
      item({ title: "Dune", author: "Frank Herbert", url: "https://example.com/d", status: "done", rating: 4, tags: ["classic", "a*b"] }),
    ]);
    expect(md).toBe("# Shelf\n\n## Done\n\n- [Dune](https://example.com/d) by Frank Herbert · ★★★★☆ · tags: classic, a\\*b\n");
  });

  test("encodes space, parentheses and angle brackets in the url", () => {
    const md = toMarkdown([item({ url: "https://e.com/a b(c)<d>" })]);
    expect(md).toContain("- [T](https://e.com/a%20b%28c%29%3Cd%3E)\n");
  });

  test("orders by id inside a group, whatever the input order", () => {
    const md = toMarkdown([item({ id: 1, title: "first" }), item({ id: 2, title: "second" })]);
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"));
  });
});
