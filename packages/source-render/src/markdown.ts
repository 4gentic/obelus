import type { Element as HastElement, Root as HastRoot, Properties } from "hast";
import { toHtml } from "hast-util-to-html";
import type { Root as MdastRoot } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";
import type { RenderResult, SourceMap, SourceMapBlock } from "./types.js";

// Leaf block-level hast tag names that carry a source position. Container
// blocks (ul/ol/table/thead/tbody/tr) are deliberately excluded — their
// rendered text concatenates child-item text in ways that don't match the
// source as a contiguous substring (lists have `-` markers between items,
// tables have pipe rows). Selection→SourceAnchor walks up to the nearest
// tagged ancestor, so cross-item selections naturally resolve to different
// per-item lines, which is the correct semantics.
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

export function renderMarkdown(input: { file: string; text: string }): RenderResult {
  let mdast: MdastRoot;
  try {
    mdast = fromMarkdown(input.text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "parse-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // `mdast-util-to-hast` preserves `position` on the resulting hast nodes,
  // which is what we need for the data-src-* projection. Without
  // `allowDangerousHtml`, raw HTML in the source is dropped — this is a
  // preview, not a publish target, so we never want to render arbitrary HTML.
  const hast = toHast(mdast) as HastRoot | null;
  if (hast === null) {
    return {
      ok: false,
      error: { kind: "parse-failed", message: "mdast-util-to-hast returned null" },
    };
  }

  const blocks: Array<SourceMapBlock> = [];
  visit(hast, "element", (node: HastElement) => {
    if (!BLOCK_TAGS.has(node.tagName)) return;
    const pos = node.position;
    if (!pos) return;
    const line = pos.start.line;
    const endLine = pos.end.line;
    // mdast columns are 1-indexed; SourceAnchor.colStart is 0-indexed.
    const colStart = Math.max(0, pos.start.column - 1);
    const colEnd = Math.max(0, pos.end.column - 1);

    const properties: Properties = node.properties ?? {};
    properties.dataSrcFile = input.file;
    properties.dataSrcLine = String(line);
    properties.dataSrcEndLine = String(endLine);
    properties.dataSrcCol = String(colStart);
    node.properties = properties;

    blocks.push({ line, colStart, colEnd });
  });

  const html = toHtml(hast);
  const sourceMap: SourceMap = { file: input.file, blocks };
  return { ok: true, html, sourceMap };
}
