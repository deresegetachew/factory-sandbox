import { describe, expect, test } from "bun:test";
import { slugify, wordCount } from "../src/textkit";

describe("slugify", () => {
  test("lowercases and turns punctuation and spaces into one dash", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  test("collapses runs of separators and trims the ends", () => {
    expect(slugify("  a--b  ")).toBe("a-b");
  });

  test("returns an empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  test("returns an empty string when there are only punctuation and whitespace", () => {
    expect(slugify("!!! ")).toBe("");
  });

  test("keeps digits", () => {
    expect(slugify("Top 10 Tips")).toBe("top-10-tips");
  });

  test("leaves no dash at either end for leading and trailing punctuation", () => {
    expect(slugify("--abc--")).toBe("abc");
  });

  test("treats underscores and tabs as separators", () => {
    expect(slugify("a_b\tc")).toBe("a-b-c");
  });

  test("leaves an existing slug unchanged", () => {
    expect(slugify("already-a-slug-123")).toBe("already-a-slug-123");
  });
});

describe("wordCount", () => {
  test("returns 0 for an empty string", () => {
    expect(wordCount("")).toBe(0);
  });

  test("ignores leading, trailing and repeated spaces", () => {
    expect(wordCount(" one  two ")).toBe(2);
  });

  test("returns 0 for a whitespace-only string", () => {
    expect(wordCount("  \t\n  ")).toBe(0);
  });

  test("returns 1 for a single word", () => {
    expect(wordCount("hello")).toBe(1);
  });

  test("treats tabs and newlines as separators", () => {
    expect(wordCount("a\tb\nc")).toBe(3);
  });

  test("does not split words on attached punctuation", () => {
    expect(wordCount("hello, world")).toBe(2);
  });
});
