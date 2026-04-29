// biome-ignore-all lint/suspicious/noConsole: CLI script — stdout is the reporting surface.

// Resolves the sample annotations' PDF coordinates by loading the bundled
// sample PDF with pdfjs-dist, locating each authored quote in the page's
// text content, and emitting a fully-typed seed module the runtime can
// import without re-running pdfjs at boot.
//
// Run with: pnpm --filter @obelus/web build:sample-seed
// (driven through tsx so the workspace `@obelus/anchor` import resolves to
// its TypeScript source.)

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { extract, rectsFromAnchor } from "@obelus/anchor";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const REGISTERED_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));

const SAMPLE_TITLE = "Daedalus & Icarus";
const SAMPLE_PDF_URL = "/sample/daedalus-icarus.pdf";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

const PDF_PATH = path.join(WEB_ROOT, "public/sample/daedalus-icarus.pdf");
const SOURCE_PATH = path.join(WEB_ROOT, "scripts/sample-annotations.source.json");
const OUT_PATH = path.join(WEB_ROOT, "src/data/sample-annotations.generated.ts");

const PDFJS_DIR = path.join(REPO_ROOT, "node_modules/pdfjs-dist");
const CMAP_URL = `${pathToFileURL(path.join(PDFJS_DIR, "cmaps")).href}/`;
const STANDARD_FONT_URL = `${pathToFileURL(path.join(PDFJS_DIR, "standard_fonts")).href}/`;

async function main() {
  const sourceText = await fs.readFile(SOURCE_PATH, "utf8");
  const source = JSON.parse(sourceText);
  const pdfBuf = await fs.readFile(PDF_PATH);

  const doc = await getDocument({
    data: new Uint8Array(pdfBuf),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pageCache = new Map();
  async function getPageData(pageNum) {
    const cached = pageCache.get(pageNum);
    if (cached) return cached;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Filter to TextItem entries (drop TextMarkedContent if any).
    const items = content.items.filter((it) => typeof it.str === "string");
    const data = { viewport, items };
    pageCache.set(pageNum, data);
    return data;
  }

  const seeds = [];
  for (const entry of source) {
    const { page: pageNum, quote, category, note } = entry;
    if (typeof pageNum !== "number" || typeof quote !== "string") {
      throw new Error(`malformed source entry: ${JSON.stringify(entry)}`);
    }
    if (!REGISTERED_CATEGORY_IDS.has(category)) {
      throw new Error(
        `unknown category ${JSON.stringify(category)} on page ${pageNum} for quote ${JSON.stringify(quote)}; must be one of: ${[...REGISTERED_CATEGORY_IDS].join(", ")}`,
      );
    }
    const { viewport, items } = await getPageData(pageNum);

    const located = locateQuote(items, quote);
    if (!located) {
      const preview = items.map((it, i) => `[${i}] ${JSON.stringify(it.str)}`).join("\n  ");
      throw new Error(
        `quote not found on page ${pageNum}: ${JSON.stringify(quote)}\n` +
          `text items on page ${pageNum}:\n  ${preview}`,
      );
    }
    const anchor = {
      pageIndex: pageNum - 1,
      startItem: located.startItem,
      startOffset: located.startOffset,
      endItem: located.endItem,
      endOffset: located.endOffset,
    };

    const ext = extract(anchor, items, viewport);
    const rects = rectsFromAnchor(anchor, items, viewport);
    if (rects.length === 0) {
      throw new Error(`quote on page ${pageNum} produced zero rects: ${JSON.stringify(quote)}`);
    }

    seeds.push({
      category,
      note,
      quote: ext.quote,
      contextBefore: ext.contextBefore,
      contextAfter: ext.contextAfter,
      anchor: {
        kind: "pdf",
        page: pageNum,
        bbox: [ext.bbox[0], ext.bbox[1], ext.bbox[2], ext.bbox[3]],
        textItemRange: {
          start: [anchor.startItem, anchor.startOffset],
          end: [anchor.endItem, anchor.endOffset],
        },
        rects: rects.map((r) => [r[0], r[1], r[2], r[3]]),
      },
    });
  }

  await doc.cleanup();
  await doc.destroy();

  const output = renderModule(seeds);
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, output, "utf8");

  // Pass through Biome so the committed output matches repo formatting and
  // subsequent regenerations don't churn the diff with lint fixes.
  execFileSync(path.join(REPO_ROOT, "node_modules/.bin/biome"), ["format", "--write", OUT_PATH], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });

  console.log(
    `[build-sample-seed] wrote ${seeds.length} seed(s) → ${path.relative(WEB_ROOT, OUT_PATH)}`,
  );
}

// Walks the page's text items, building a normalized concatenation with a
// position map back to (itemIndex, offsetInItem). Inserts a synthetic space
// at item boundaries that don't already carry whitespace, so quotes that
// span line/word breaks still match.
function locateQuote(items, quote) {
  let acc = "";
  const positions = []; // positions[k] = { itemIndex, offset } parallel to acc

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const str = item.str;
    if (acc.length > 0) {
      const last = acc[acc.length - 1];
      const first = str.charAt(0);
      const needsBoundary = str.length > 0 && !/\s/.test(last) && first !== "" && !/\s/.test(first);
      if (needsBoundary) {
        acc += " ";
        positions.push({ itemIndex: -1, offset: -1 });
      }
    }
    for (let j = 0; j < str.length; j += 1) {
      acc += str[j];
      positions.push({ itemIndex: i, offset: j });
    }
  }

  // Collapse runs of whitespace to single spaces, with a parallel position map.
  let normAcc = "";
  const normPositions = [];
  let prevWasSpace = false;
  for (let k = 0; k < acc.length; k += 1) {
    const ch = acc[k];
    if (/\s/.test(ch)) {
      if (!prevWasSpace && normAcc.length > 0) {
        normAcc += " ";
        normPositions.push(positions[k]);
      }
      prevWasSpace = true;
    } else {
      normAcc += ch;
      normPositions.push(positions[k]);
      prevWasSpace = false;
    }
  }
  // Trim trailing space if any.
  if (normAcc.endsWith(" ")) {
    normAcc = normAcc.slice(0, -1);
    normPositions.pop();
  }

  const normQuote = quote.replace(/\s+/g, " ").trim();
  const idx = normAcc.indexOf(normQuote);
  if (idx === -1) return null;
  if (normAcc.indexOf(normQuote, idx + 1) !== -1) {
    throw new Error(
      `ambiguous quote — appears more than once on the page: ${JSON.stringify(quote)}`,
    );
  }

  // Step start forward past synthetic-boundary positions to the first real char.
  let startK = idx;
  while (startK < idx + normQuote.length && normPositions[startK].itemIndex === -1) {
    startK += 1;
  }
  // Step end backward past synthetic-boundary positions to the last real char.
  let endK = idx + normQuote.length - 1;
  while (endK >= startK && normPositions[endK].itemIndex === -1) {
    endK -= 1;
  }
  if (startK > endK) return null;

  const start = normPositions[startK];
  const end = normPositions[endK];
  return {
    startItem: start.itemIndex,
    startOffset: start.offset,
    endItem: end.itemIndex,
    endOffset: end.offset + 1,
  };
}

function renderModule(seeds) {
  const header = [
    "// GENERATED — do not edit by hand.",
    "// Run `pnpm --filter @obelus/web build:sample-seed` to regenerate.",
    "// Source: apps/web/scripts/sample-annotations.source.json",
    "",
    'import type { PdfAnchorFields } from "@obelus/repo";',
    "",
    `export const SAMPLE_TITLE = ${JSON.stringify(SAMPLE_TITLE)};`,
    `export const SAMPLE_PDF_URL = ${JSON.stringify(SAMPLE_PDF_URL)};`,
    "",
    "export interface SampleAnnotationSeed {",
    "  category: string;",
    "  note: string;",
    "  quote: string;",
    "  contextBefore: string;",
    "  contextAfter: string;",
    "  anchor: PdfAnchorFields;",
    "}",
    "",
    "export const SAMPLE_SEED: ReadonlyArray<SampleAnnotationSeed> = [",
  ];
  const body = seeds.map((s) => `  ${stringifySeed(s)}`).join(",\n");
  const footer = ["];", ""];
  return [...header, body, ...footer].join("\n");
}

function stringifySeed(seed) {
  // Compact, deterministic JSON-ish output. Key order is fixed so re-runs
  // produce stable diffs.
  const a = seed.anchor;
  const lines = [
    "{",
    `    category: ${JSON.stringify(seed.category)},`,
    `    note: ${JSON.stringify(seed.note)},`,
    `    quote: ${JSON.stringify(seed.quote)},`,
    `    contextBefore: ${JSON.stringify(seed.contextBefore)},`,
    `    contextAfter: ${JSON.stringify(seed.contextAfter)},`,
    "    anchor: {",
    '      kind: "pdf",',
    `      page: ${a.page},`,
    `      bbox: [${a.bbox.map(num).join(", ")}],`,
    "      textItemRange: {",
    `        start: [${a.textItemRange.start[0]}, ${a.textItemRange.start[1]}],`,
    `        end: [${a.textItemRange.end[0]}, ${a.textItemRange.end[1]}],`,
    "      },",
    `      rects: [${a.rects.map((r) => `[${r.map(num).join(", ")}]`).join(", ")}],`,
    "    },",
    "  }",
  ];
  return lines.join("\n");
}

function num(n) {
  // Round to 4 decimal places so scale-1 viewport coords are stable across
  // runs without perceptible drift in the highlight overlay.
  return Number.parseFloat(n.toFixed(4));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
