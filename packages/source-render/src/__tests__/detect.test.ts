import { describe, expect, it } from "vitest";
import { detectLatexBinary, LATEX_BINARIES } from "../detect.js";
import type { Spawner } from "../spawner.js";

function mockSpawner(present: ReadonlySet<string>): Spawner {
  return {
    async which(bin) {
      return present.has(bin) ? `/usr/bin/${bin}` : null;
    },
    async run() {
      throw new Error("run() not used in detect tests");
    },
    async readFile() {
      throw new Error("readFile() not used in detect tests");
    },
    async writeFile() {
      throw new Error("writeFile() not used in detect tests");
    },
  };
}

describe("detectLatexBinary", () => {
  it("returns the first binary present on $PATH", async () => {
    const result = await detectLatexBinary(mockSpawner(new Set(["pandoc"])));
    expect(result).toEqual({ ok: true, bin: "pandoc", resolvedPath: "/usr/bin/pandoc" });
  });

  it("prefers make4ht over htlatex over pandoc when multiple are present", async () => {
    const result = await detectLatexBinary(mockSpawner(new Set(["htlatex", "make4ht", "pandoc"])));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bin).toBe("make4ht");
  });

  it("returns the full tried list when nothing is found", async () => {
    const result = await detectLatexBinary(mockSpawner(new Set()));
    expect(result).toEqual({ ok: false, tried: LATEX_BINARIES });
  });
});
