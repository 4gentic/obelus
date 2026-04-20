import { describe, expect, it } from "vitest";
import { renderTypst } from "../typst.js";

describe("renderTypst", () => {
  it("returns unsupported until upstream HTML output is wired", async () => {
    const result = await renderTypst({
      file: "doc.typ",
      text: "= Title\nbody",
      rootDir: "/tmp",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported");
    }
  });
});
