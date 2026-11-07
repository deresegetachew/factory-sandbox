import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(":memory:");
});
const get = (path: string) => app.fetch(new Request("http://x" + path));
const loadData = async () => (await import("../../src/shelf/public/data.js")) as any;

describe("Markdown export in the page", () => {
  test("the Import and export section has an Export Markdown download link", async () => {
    const html = await (await get("/")).text();
    const link = html.match(/<a\b(?=[^>]*href="\/api\/export\?format=md")(?=[^>]*\bdownload\b)[^>]*>\s*Export Markdown\s*<\/a>/);
    expect(link).not.toBeNull();
    const section = html.slice(html.indexOf('id="files-heading"'));
    expect(section).toContain('href="/api/export?format=md"');
    expect(section).toContain('href="/api/export?format=json"');
    expect(section).toContain('href="/api/export?format=csv"');
  });

  test("exportPath('md') is /api/export?format=md", async () => {
    const data = await loadData();
    expect(data.exportPath("md")).toBe("/api/export?format=md");
  });

  test("the import file input still accepts only .json and .csv", async () => {
    const html = await (await get("/")).text();
    expect(html).toMatch(/<input\b(?=[^>]*type="file")(?=[^>]*accept="\.json,\.csv")[^>]*>/);
  });
});
