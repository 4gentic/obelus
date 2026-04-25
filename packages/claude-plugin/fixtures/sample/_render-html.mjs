// biome-ignore-all lint/suspicious/noConsole: one-shot fixture generator — stdout is the reporting surface.
// One-shot generator: renders sample.md → sample.html via @obelus/source-render.
// Run from the repo root: `node packages/claude-plugin/fixtures/sample/_render-html.mjs`.
// Output is a paired-source HTML manuscript whose body carries data-html-file
// (anchor wiring) and whose <article> carries data-src-file plus data-src-line/
// data-src-end-line/data-src-col on every leaf block — the same shape the
// desktop preview emits at runtime, so the bundle-html-paired fixture's
// xpath/charOffset values can be computed against a known-good rendering.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../../../source-render/src/markdown.ts";

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(here, "sample.md"), "utf8");

const result = renderMarkdown({ file: "sample.md", text: md });
if (!result.ok) {
  console.error("renderMarkdown failed:", result.error);
  process.exit(1);
}

const shell = `<!doctype html>
<html lang="en">
<head><title>On the Scalability of Transformer Attention</title></head>
<body data-html-file="sample.html">
<article data-src-file="sample.md">
${result.html}
</article>
</body>
</html>
`;

writeFileSync(resolve(here, "sample.html"), shell);
console.log("wrote sample.html");
