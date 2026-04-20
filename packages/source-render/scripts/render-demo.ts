// Hand-runnable end-to-end demo for Phase 5.
//
// Usage:
//   pnpm -C packages/source-render demo --file fixtures/sample.md
//   pnpm -C packages/source-render demo --file fixtures/sample.tex
//
// Verifies four things at once:
//   1. The renderer produces HTML with data-src-file/line/col on every block.
//   2. The sourceMap entries match what's stamped on the DOM.
//   3. selectionToSourceAnchor (from @obelus/anchor) lifts a synthetic
//      selection over a real block back to a SourceAnchor.
//   4. verifySourceAnchor round-trips the anchor against the original
//      file text.
//
// Prints a per-block PASS/FAIL summary. Exit 1 if anything fails to
// round-trip — useful as a sanity check before declaring Phase 5 done.

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { selectionToSourceAnchor, verifySourceAnchor } from "@obelus/anchor";
import { Window } from "happy-dom";
import { renderLatex } from "../src/latex.js";
import { renderMarkdown } from "../src/markdown.js";
import { nodeSpawner } from "../src/spawner.js";
import type { RenderResult } from "../src/types.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error("usage: render-demo --file <path>");
  process.exit(2);
}

const filePath = isAbsolute(args.file) ? args.file : resolve(process.cwd(), args.file);
const text = await readFile(filePath, "utf8");
const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
const rootDir = dirname(filePath);

let result: RenderResult;
if (ext === "md" || ext === "markdown") {
  result = renderMarkdown({ file: args.file, text });
} else if (ext === "tex") {
  result = await renderLatex({ file: args.file, text, rootDir }, nodeSpawner());
} else {
  console.error(`unsupported extension: .${ext} (try .md or .tex)`);
  process.exit(2);
}

say(`\n— ${args.file} —\n`);

if (!result.ok) {
  say(`render failed: ${result.error.kind}`);
  if (result.error.kind === "binary-missing") {
    say(`  tried: ${result.error.tried.join(", ")}`);
    say("  install pandoc:  brew install pandoc");
  } else if (result.error.kind === "render-failed") {
    say(`  exit ${result.error.exitCode}`);
    if (result.error.stderr.trim().length > 0) say(`  stderr: ${result.error.stderr}`);
  } else if (result.error.kind === "parse-failed" || result.error.kind === "unsupported") {
    say(`  ${result.error.message}`);
  }
  process.exit(1);
}

say(`rendered ${result.sourceMap.blocks.length} block(s)`);
say("first 200 chars of HTML:");
say(`  ${result.html.replace(/\s+/g, " ").slice(0, 200)}…\n`);

// Round-trip every block: synthesize a Selection over its full text content,
// derive the SourceAnchor, verify it against the original file. Parsing via
// DOMParser keeps the demo aligned with how the live preview pane will
// receive the HTML — no innerHTML assignment needed.
const win = new Window();
const DocParser = (win as unknown as { DOMParser: new () => DOMParser }).DOMParser;
const parsed = new DocParser().parseFromString(
  `<!doctype html><html><body>${result.html}</body></html>`,
  "text/html",
);
const container = parsed.body;

const blocks = container.querySelectorAll("[data-src-file]") as unknown as ArrayLike<HTMLElement>;
let pass = 0;
let fail = 0;

for (let i = 0; i < blocks.length; i += 1) {
  const block = blocks[i];
  if (!block) continue;
  const firstText = firstTextNode(block);
  const lastText = lastTextNode(block);
  if (!firstText || !lastText) continue;

  const anchor = selectionToSourceAnchor({
    anchorNode: firstText as unknown as Node,
    anchorOffset: 0,
    focusNode: lastText as unknown as Node,
    focusOffset: lastText.nodeValue?.length ?? 0,
  });

  const blockText = (block.textContent ?? "").trim();
  const preview = blockText.length > 60 ? `${blockText.slice(0, 60)}…` : blockText;

  if (!anchor) {
    say(`  [FAIL] block ${i + 1}: no anchor (${preview})`);
    fail += 1;
    continue;
  }

  const verdict = verifySourceAnchor(anchor, text, blockText);
  if (verdict.ok) {
    say(`  [PASS] block ${i + 1} L${anchor.lineStart}: ${preview}`);
    pass += 1;
  } else {
    say(
      `  [FAIL] block ${i + 1} L${anchor.lineStart}-${anchor.lineEnd} (${verdict.reason}): ${preview}`,
    );
    fail += 1;
  }
}

say(`\n${pass} pass · ${fail} fail (${blocks.length} blocks total)`);
process.exit(fail === 0 ? 0 : 1);

function parseArgs(argv: ReadonlyArray<string>): { file?: string } {
  const out: { file?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file" && i + 1 < argv.length) {
      out.file = argv[i + 1];
      i += 1;
    } else if (a?.startsWith("--file=")) {
      out.file = a?.slice("--file=".length);
    }
  }
  return out;
}

function firstTextNode(root: Node): Node | null {
  if (root.nodeType === 3) return root;
  for (let i = 0; i < root.childNodes.length; i += 1) {
    const child = root.childNodes[i];
    if (!child) continue;
    const found = firstTextNode(child);
    if (found) return found;
  }
  return null;
}

function lastTextNode(root: Node): Node | null {
  if (root.nodeType === 3) return root;
  for (let i = root.childNodes.length - 1; i >= 0; i -= 1) {
    const child = root.childNodes[i];
    if (!child) continue;
    const found = lastTextNode(child);
    if (found) return found;
  }
  return null;
}
