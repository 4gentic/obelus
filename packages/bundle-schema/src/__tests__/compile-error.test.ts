import { describe, expect, it } from "vitest";
import { COMPILE_ERROR_BUNDLE_VERSION, CompileErrorBundle } from "../compile-error.js";

const base = {
  bundleVersion: COMPILE_ERROR_BUNDLE_VERSION,
  tool: { name: "obelus", version: "0.1.0" },
  project: { rootLabel: "negotiated_autonomy", main: { relPath: "paper/main.typ", format: "typ" } },
  paperId: "d5492102-684d-4e0e-9aa6-d436d88556bc",
  compiler: "typst",
  stderr: "error: unexpected end of block",
  trigger: "apply",
} as const;

describe("CompileErrorBundle", () => {
  it("accepts a real exit code when the compiler ran and rejected the source", () => {
    const parsed = CompileErrorBundle.parse({ ...base, exitCode: 1 });
    expect(parsed.exitCode).toBe(1);
  });

  it("accepts a bundle with no exit code (the compiler couldn't run at all)", () => {
    const parsed = CompileErrorBundle.parse(base);
    expect(parsed.exitCode).toBeUndefined();
  });
});
