import { describe, expect, it } from "vitest";
import { sha256Hex } from "../opfs";

function randomBytes(n: number): ArrayBuffer {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) buf[i] = Math.floor(Math.random() * 256);
  return buf.buffer;
}

describe("opfs sha256", () => {
  it("computes a stable 64-char hex digest", async () => {
    const bytes = new TextEncoder().encode("hello world").buffer;
    const hex = await sha256Hex(bytes);
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
    expect(hex).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("produces different digests for different inputs", async () => {
    const a = await sha256Hex(randomBytes(64));
    const b = await sha256Hex(randomBytes(64));
    expect(a).not.toBe(b);
  });
});

const hasOpfs =
  typeof navigator !== "undefined" &&
  "storage" in navigator &&
  typeof navigator.storage?.getDirectory === "function";

describe.skipIf(!hasOpfs)("opfs round-trip", () => {
  it("writes and reads back a pdf by sha", async () => {
    const mod = await import("../opfs");
    const bytes = randomBytes(1024);
    const sha = await mod.putPdf(bytes);
    expect(sha).toMatch(/^[a-f0-9]{64}$/);
    const read = await mod.getPdf(sha);
    expect(read).not.toBeNull();
    expect(read?.byteLength).toBe(1024);
    const reSha = await mod.sha256Hex(read as ArrayBuffer);
    expect(reSha).toBe(sha);
  });
});
