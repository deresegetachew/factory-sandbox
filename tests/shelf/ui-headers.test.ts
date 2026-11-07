import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/shelf/server";

const get = (path: string) => createApp(":memory:").fetch(new Request("http://x" + path));

describe("UI security headers", () => {
  for (const path of ["/", "/app.js", "/render.js", "/style.css"]) {
    test(`${path} forbids framing and other origins' scripts, and is not sniffed`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("unsafe-eval");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  }
});
