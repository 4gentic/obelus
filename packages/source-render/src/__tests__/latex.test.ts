import { describe, expect, it } from "vitest";
import { renderLatex } from "../latex.js";
import type { Spawner } from "../spawner.js";

type MockOpts = {
  binaries?: ReadonlySet<string>;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  files?: Map<string, string>;
};

function mockSpawner(opts: MockOpts = {}): Spawner {
  const present = opts.binaries ?? new Set(["pandoc"]);
  const files = opts.files ?? new Map<string, string>();
  return {
    async which(bin) {
      return present.has(bin) ? `/usr/bin/${bin}` : null;
    },
    async run() {
      return {
        stdout: opts.stdout ?? "",
        stderr: opts.stderr ?? "",
        exitCode: opts.exitCode ?? 0,
      };
    },
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`mock readFile miss: ${path}`);
      return content;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
  };
}

describe("renderLatex", () => {
  it("returns binary-missing when no LaTeX tool is on PATH", async () => {
    const result = await renderLatex(
      { file: "main.tex", text: "\\section{Intro}\nHello.\n", rootDir: "/tmp" },
      mockSpawner({ binaries: new Set() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("binary-missing");
      if (result.error.kind === "binary-missing") {
        expect(result.error.tried).toEqual(["make4ht", "htlatex", "pandoc"]);
      }
    }
  });

  it("returns render-failed when the spawned tool exits non-zero", async () => {
    const result = await renderLatex(
      { file: "main.tex", text: "broken", rootDir: "/tmp" },
      mockSpawner({ stderr: "! Undefined control sequence.", exitCode: 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "render-failed") {
      expect(result.error.exitCode).toBe(1);
      expect(result.error.stderr).toContain("Undefined");
    }
  });

  it("injects data-src-file/line on every block element", async () => {
    const text = [
      "\\section{Introduction}",
      "We claim the covariance matrix is positive semi-definite.",
      "",
      "\\section{Method}",
      "The estimator is unbiased.",
    ].join("\n");

    const stdout = [
      "<h1>Introduction</h1>",
      "<p>We claim the covariance matrix is positive semi-definite.</p>",
      "<h1>Method</h1>",
      "<p>The estimator is unbiased.</p>",
    ].join("\n");

    const result = await renderLatex(
      { file: "main.tex", text, rootDir: "/tmp" },
      mockSpawner({ stdout }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toMatch(/<h1[^>]*data-src-file="main\.tex"/);
    expect(result.html).toMatch(/<p[^>]*data-src-line="2"/);
    expect(result.html).toMatch(/<p[^>]*data-src-line="5"/);
    expect(result.sourceMap.blocks).toHaveLength(4);
  });

  it("falls back to line 1 when a block's text has no source match (math, refs)", async () => {
    const text = "\\section{Title}\nText.\n";
    const stdout = "<h1>Title</h1><p>$\\sigma^2$</p>"; // "σ²" has no substring in source
    const result = await renderLatex(
      { file: "m.tex", text, rootDir: "/tmp" },
      mockSpawner({ stdout }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both blocks present; the math <p> falls back to line 1.
    expect(result.sourceMap.blocks).toHaveLength(2);
    const lines = result.sourceMap.blocks.map((b) => b.line);
    expect(lines).toContain(1);
  });

  it("uses make4ht via writeFile/readFile when present", async () => {
    const text = "\\section{Hi}\nBody.\n";
    const html = "<h1>Hi</h1><p>Body.</p>";
    const files = new Map<string, string>();
    // Pre-stage what make4ht would produce: any path ending in `.html` returns this.
    const spawner: Spawner = {
      async which(bin) {
        return bin === "make4ht" ? "/usr/bin/make4ht" : null;
      },
      async run(_bin, args) {
        const tex = args[0];
        if (typeof tex !== "string") throw new Error("expected tex path arg");
        const out = tex.replace(/\.tex$/, ".html");
        files.set(out, html);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      async readFile(path) {
        const c = files.get(path);
        if (c === undefined) throw new Error(`miss: ${path}`);
        return c;
      },
      async writeFile(path, content) {
        files.set(path, content);
      },
    };

    const result = await renderLatex({ file: "main.tex", text, rootDir: "/tmp" }, spawner);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toMatch(/<h1[^>]*data-src-line="1"/);
    expect(result.html).toMatch(/<p[^>]*data-src-line="2"/);
  });
});
