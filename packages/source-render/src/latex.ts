import type { Element as HastElement, Root as HastRoot, Properties } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { visit } from "unist-util-visit";
import { detectLatexBinary, type LatexBinary } from "./detect.js";
import type { Spawner } from "./spawner.js";
import type { RenderResult, SourceMapBlock } from "./types.js";

// Leaf-only set, same reasoning as markdown.ts: container/wrapper tags
// (ul, ol, table rows, section, article, div) get text concatenations that
// don't match source as substrings. Selection→SourceAnchor walks up to
// the nearest tagged leaf, so this is what we want.
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "li",
  "th",
  "td",
  "hr",
]);

// First N chars of a block's text used as the substring needle. Long enough
// to be unique in academic prose, short enough to survive macro expansion
// changes (citations rendered as numbers, refs as labels).
const NEEDLE_LEN = 40;

export async function renderLatex(
  input: { file: string; text: string; rootDir: string },
  spawner: Spawner,
): Promise<RenderResult> {
  const detection = await detectLatexBinary(spawner);
  if (!detection.ok) {
    return { ok: false, error: { kind: "binary-missing", tried: detection.tried } };
  }

  const rawHtml = await runRenderer(detection.bin, input, spawner);
  if (!rawHtml.ok) return rawHtml;

  return injectSourceMap(rawHtml.html, input.text, input.file);
}

type RendererOk = { ok: true; html: string };

async function runRenderer(
  bin: LatexBinary,
  input: { file: string; text: string; rootDir: string },
  spawner: Spawner,
): Promise<RendererOk | RenderResult> {
  if (bin === "pandoc") {
    const result = await spawner.run("pandoc", ["-f", "latex", "-t", "html5", "--wrap=preserve"], {
      cwd: input.rootDir,
      stdin: input.text,
    });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: { kind: "render-failed", stderr: result.stderr, exitCode: result.exitCode },
      };
    }
    return { ok: true, html: result.stdout };
  }

  // make4ht / htlatex: both write a sibling .html file next to the input.
  // We isolate by writing to a stable temp basename in the project root so
  // the user's tree isn't polluted with intermediate aux/log files.
  const stamp = Date.now().toString(36);
  const stem = `.obelus-render-${stamp}`;
  const texPath = `${input.rootDir}/${stem}.tex`;
  const htmlPath = `${input.rootDir}/${stem}.html`;

  await spawner.writeFile(texPath, input.text);
  const result = await spawner.run(bin, [texPath], { cwd: input.rootDir });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: { kind: "render-failed", stderr: result.stderr, exitCode: result.exitCode },
    };
  }
  const html = await spawner.readFile(htmlPath);
  return { ok: true, html };
}

// Walks the rendered HTML and, for each block element, searches the original
// LaTeX source for the first NEEDLE_LEN chars of the block's text content.
// Best-effort: math, citations, refs, and macro-expanded prose won't match;
// the verifier round-trip in @obelus/anchor flags those as
// `sourceMapUnverified: true`. Line precision only — column is always 0.
function injectSourceMap(rawHtml: string, sourceText: string, file: string): RenderResult {
  let tree: HastRoot;
  try {
    tree = fromHtml(rawHtml, { fragment: true });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "parse-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const lineOffsets = computeLineOffsets(sourceText);
  const blocks: Array<SourceMapBlock> = [];

  visit(tree, "element", (node: HastElement) => {
    if (!BLOCK_TAGS.has(node.tagName)) return;
    const text = nodeText(node).trim();
    if (text.length === 0) return;

    const needle = text.slice(0, NEEDLE_LEN);
    const idx = sourceText.indexOf(needle);
    const line = idx === -1 ? 1 : offsetToLine(idx, lineOffsets);

    const properties: Properties = node.properties ?? {};
    properties.dataSrcFile = file;
    properties.dataSrcLine = String(line);
    properties.dataSrcEndLine = String(line);
    properties.dataSrcCol = "0";
    node.properties = properties;

    blocks.push({ line, colStart: 0, colEnd: 0 });
  });

  const html = toHtml(tree);
  return { ok: true, html, sourceMap: { file, blocks } };
}

function nodeText(node: HastElement): string {
  const parts: Array<string> = [];
  visit(node, "text", (text) => {
    parts.push(text.value);
  });
  return parts.join("");
}

function computeLineOffsets(text: string): Array<number> {
  const offsets: Array<number> = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offset: number, lineOffsets: ReadonlyArray<number>): number {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = lineOffsets[mid] ?? 0;
    if (start === offset) return mid + 1;
    if (start < offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi + 1);
}
