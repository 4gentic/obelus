import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../sanitize";

// happy-dom + DOMPurify don't strip every forbidden tag the way a real
// browser would (DOMPurify uses DOMParser internally, and happy-dom's
// implementation diverges). These tests therefore validate the config
// surface and the dropped-script accounting we own — they are NOT a
// substitute for the production browser smoke test that exercises the
// full sanitiser against a malicious HTML payload.

describe("sanitizeHtml", () => {
  it("returns a { html, droppedScripts } shape", () => {
    const result = sanitizeHtml("<p>safe</p>");
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("droppedScripts");
    expect(typeof result.html).toBe("string");
    expect(typeof result.droppedScripts).toBe("number");
  });

  it("preserves a plain paragraph round-trip", () => {
    const result = sanitizeHtml("<p>hello world</p>");
    expect(result.html).toContain("<p>hello world</p>");
    expect(result.droppedScripts).toBe(0);
  });

  it("counts a removed <script> via the uponSanitizeElement hook", () => {
    const result = sanitizeHtml("<p>safe</p><script>alert(1)</script>");
    expect(result.droppedScripts).toBeGreaterThanOrEqual(1);
    expect(result.html).toContain("<p>safe</p>");
    expect(result.html).not.toContain("alert(1)");
  });

  it("preserves http(s), blob:, data:, fragment, and relative href values", () => {
    const result = sanitizeHtml(
      '<a href="https://e.com/x">a</a>' +
        '<a href="blob:abc">b</a>' +
        '<a href="data:text/plain,hi">c</a>' +
        '<a href="#section">d</a>' +
        '<a href="figs/x.png">e</a>',
    );
    expect(result.html).toContain('href="https://e.com/x"');
    expect(result.html).toContain('href="blob:abc"');
    expect(result.html).toContain("data:text/plain");
    expect(result.html).toContain('href="#section"');
    expect(result.html).toContain('href="figs/x.png"');
  });

  it("rejects javascript: URLs in href", () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result.html).not.toMatch(/javascript:/i);
  });

  it("removes inline event handlers (DOMPurify default)", () => {
    const result = sanitizeHtml('<button onclick="boom()">x</button>');
    expect(result.html).not.toContain("onclick");
    expect(result.html).toContain("<button");
  });

  it("does not preserve script-tag children verbatim", () => {
    const result = sanitizeHtml("<p>first</p><script>secret_payload_42</script><p>last</p>");
    expect(result.html).not.toContain("secret_payload_42");
    expect(result.html).toContain("<p>first</p>");
    expect(result.html).toContain("<p>last</p>");
  });
});
