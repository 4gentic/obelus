// Pure helpers for the metrics-capture harness (scripts/capture-metrics.mjs).
// Extracted so the bundle synthesis, boundary-event derivation, prelude
// rendering, and path sanitizer can be unit-tested without spawning an engine.
//
// Everything here is deterministic given (fixture source, mark count, ids) so
// the dry self-test can assert exact shapes. The harness imports `buildBundle`
// and the metric/plan Zod schemas from the workspace packages — there is no
// hand-typed duplicate of either contract.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
// Imported by relative path (not the `@obelus/*` specifier) so `tsx` resolves
// the TS sources directly without depending on root node_modules hoisting —
// the same pattern scripts/render-prompt-fragments.mjs uses.
import { buildBundle } from "../../packages/bundle-builder/src/index.ts";
import { DEFAULT_CATEGORIES } from "../../packages/categories/src/index.ts";

// The capture cycles marks through the substantive editorial categories. We
// skip `note` (a no-op pointer that the planner may legitimately drop, which
// would make the mark count and the plan-block count diverge for reasons
// unrelated to scale) and `praise` is included once so a praise-only window
// is exercised. Order matters only for reproducibility of a given N.
const CAPTURE_CATEGORIES = ["rephrase", "wrong", "improve", "elaborate", "weak-argument", "praise"];

// Deterministic UUID v4-shaped ids for synthesized annotations. Not random:
// a re-run with the same N produces the same ids, so two snapshots diff only
// on the timings that actually changed. Hex nibble `n` fills the variable
// fields; the version (4) and variant (8) nibbles are fixed per RFC 4122 so
// the bundle schema's `uuid` check passes.
export function syntheticAnnotationId(index) {
  const h = (index + 1).toString(16).padStart(2, "0");
  const block = h.repeat(6).slice(0, 12);
  return `${block.slice(0, 8)}-${block.slice(0, 4)}-4${block.slice(0, 3)}-8${block.slice(0, 3)}-${block.repeat(2).slice(0, 12)}`;
}

// Pull the prose-bearing lines out of a source file: non-blank lines that are
// not markup-only (a TeX `\section{...}` or a markdown `#` heading carries no
// quotable sentence). Returns { line (1-based), text } in document order. The
// selector is intentionally simple — the marks only need to land on a real
// span the planner can locate; they do not need to be editorially meaningful.
export function proseLinesOf(sourceText) {
  const out = [];
  const lines = sourceText.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    const trimmed = text.trim();
    if (trimmed.length < 24) continue;
    if (trimmed.startsWith("\\") && trimmed.endsWith("}") && !/[.!?]/.test(trimmed)) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^[%<]/.test(trimmed)) continue;
    out.push({ line: i + 1, text });
  }
  return out;
}

// Choose N spans from the prose lines, spreading them across the document so a
// high-N capture exercises locator windows in every section rather than
// clustering. When N exceeds the available prose lines we wrap and re-use
// lines (still valid: two marks on one line is a real reviewer pattern), which
// lets `--marks 25` run against the small fixture.
export function selectSpans(proseLines, markCount) {
  if (proseLines.length === 0) {
    throw new Error("fixture source has no prose lines to anchor marks on");
  }
  const spans = [];
  for (let i = 0; i < markCount; i += 1) {
    const src = proseLines[i % proseLines.length];
    spans.push(src);
  }
  return spans;
}

// Build a schema-valid bundle carrying `markCount` source-anchored annotations
// against the fixture entrypoint. Reuses the production `buildBundle`, so the
// output passes the same validation the desktop's exporter produces. The quote
// is the first ~60 chars of the chosen line; contextBefore/After are short
// neighbouring slices, mirroring what the reviewer's selection capture stores.
export function synthesizeBundle(opts) {
  const { entrypointRelPath, sourceText, markCount, paperTitle, projectLabel, projectId, paperId } =
    opts;
  const proseLines = proseLinesOf(sourceText);
  const spans = selectSpans(proseLines, markCount);
  const categoryIds = new Set(DEFAULT_CATEGORIES.map((c) => c.id));

  const annotations = spans.map((span, index) => {
    const requested = CAPTURE_CATEGORIES[index % CAPTURE_CATEGORIES.length];
    const category = categoryIds.has(requested) ? requested : "note";
    const lineText = span.text;
    const quote = sliceQuote(lineText);
    const colStart = Math.max(0, lineText.indexOf(quote.trimStart().slice(0, 8)));
    return {
      id: syntheticAnnotationId(index),
      paperId,
      category,
      quote,
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "source",
        file: entrypointRelPath,
        lineStart: span.line,
        colStart,
        lineEnd: span.line,
        colEnd: colStart + quote.length,
      },
      note: noteFor(category),
      thread: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  });

  const bundle = buildBundle({
    project: {
      id: projectId,
      label: projectLabel,
      kind: "writer",
      categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
      main: entrypointRelPath,
      files: [{ relPath: entrypointRelPath, format: formatOf(entrypointRelPath) }],
    },
    papers: [
      {
        id: paperId,
        title: paperTitle,
        revisionNumber: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        entrypoint: entrypointRelPath,
      },
    ],
    annotations,
  });
  return bundle;
}

function sliceQuote(lineText) {
  const trimmed = lineText.trim();
  const max = 64;
  if (trimmed.length <= max) return trimmed;
  // Cut on a word boundary so the quote reads as a phrase, not a fragment.
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 24 ? cut.slice(0, lastSpace) : cut;
}

function noteFor(category) {
  const meta = DEFAULT_CATEGORIES.find((c) => c.id === category);
  return meta ? `Capture mark (${meta.label}): ${meta.description}` : "Capture mark.";
}

function formatOf(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf(".") + 1);
  if (ext === "tex" || ext === "md" || ext === "typ" || ext === "html") return ext;
  return "tex";
}

// Anchor-kind histogram + byte size, computed exactly as Rust's
// `compute_bundle_stats` does (preflight.rs) — counts are pure functions of the
// bundle, so the harness reproduces the desktop's `bundle-stats` numbers
// without the Rust path.
export function bundleStatsFields(bundle, rawJson) {
  let anchorSource = 0;
  let anchorPdf = 0;
  let anchorHtml = 0;
  for (const ann of bundle.annotations) {
    const kind = ann.anchor.kind;
    if (kind === "source") anchorSource += 1;
    else if (kind === "pdf") anchorPdf += 1;
    else anchorHtml += 1; // html and html-element both count as html upstream
  }
  return {
    annotations: bundle.annotations.length,
    anchorSource,
    anchorPdf,
    anchorHtml,
    papers: bundle.papers.length,
    files: bundle.project.files?.length ?? 0,
    bytes: Buffer.byteLength(rawJson, "utf8"),
  };
}

// `anchor-resolution` counts. A synthesized capture is all-source by
// construction (no PDF to fuzzy-resolve), mirroring `build-bundle.ts`'s
// AnchorResolutionCounts on the resolved path.
export function anchorResolutionFields(bundle) {
  const stats = bundleStatsFields(bundle, "");
  return {
    source: stats.anchorSource,
    pdfFallback: stats.anchorPdf,
    htmlFallback: stats.anchorHtml,
  };
}

// `plan-stats` from a parsed plan JSON. Ported verbatim from
// `jobs-listener.tsx::emitPlanStats` so the snapshot matches what the desktop
// would have written for the same plan. `planStatsCategories` is the current
// 6-key vocabulary from metrics.ts (rephrase/wrong/praise/cascade/impact/
// quality) — NOT the older `unclear`-keyed baselines.
export function planStatsFields(plan, planStatsCategories) {
  const byCategory = {
    rephrase: 0,
    wrong: 0,
    praise: 0,
    cascade: 0,
    impact: 0,
    quality: 0,
  };
  let ambiguous = 0;
  let totalDiffLines = 0;
  let nonEmptyDiffs = 0;
  const isCategory = (v) => planStatsCategories.includes(v);
  for (const b of plan.blocks) {
    const firstId = b.annotationIds[0] ?? "";
    let bucket = null;
    if (firstId.startsWith("cascade-")) bucket = "cascade";
    else if (firstId.startsWith("impact-")) bucket = "impact";
    else if (firstId.startsWith("quality-")) bucket = "quality";
    else if (isCategory(b.category)) bucket = b.category;
    if (bucket) byCategory[bucket] += 1;
    if (b.ambiguous) ambiguous += 1;
    if (b.patch !== "") {
      nonEmptyDiffs += 1;
      totalDiffLines += b.patch.split("\n").length;
    }
  }
  const avgDiffLines = nonEmptyDiffs === 0 ? 0 : totalDiffLines / nonEmptyDiffs;
  return { blocks: plan.blocks.length, byCategory, ambiguous, avgDiffLines };
}

// A compact prelude that hands the model the same ground-truth facts the
// desktop's Rust prelude does (format, entrypoint, counts, anchor histogram,
// locator windows, whole-paper read list, bundle-validated). It is NOT a
// byte-for-byte port of preflight.rs — the prelude shapes the model's run, not
// the metric contract, so a faithful summary keeps the capture on the same
// rails without re-implementing Rust string-building in JS. See the harness
// README for why this divergence is acceptable.
export function renderPrelude(bundle, planFixSkillAbsPath) {
  const entrypoint = bundle.project.main ?? bundle.papers[0]?.entrypoint ?? "";
  const format = formatLabel(entrypoint);
  const lines = [];
  lines.push("Pre-flight (validated by the desktop; trust it, do not re-derive):");
  lines.push("- bundle-validated: true");
  if (planFixSkillAbsPath) lines.push(`- plan-fix skill: ${planFixSkillAbsPath}`);
  lines.push(`- format: ${format || "(unknown)"}`);
  lines.push(`- entrypoint: ${entrypoint || "(unknown)"}`);
  lines.push(`- papers: ${bundle.papers.length}, annotations: ${bundle.annotations.length}`);
  const hist = anchorResolutionFields(bundle);
  lines.push(
    `- anchor-kind histogram: source=${hist.source}, pdf=${hist.pdfFallback}, html=${hist.htmlFallback}`,
  );
  const windows = sourceWindows(bundle);
  if (windows.length === 0) {
    lines.push("- locator windows (per-mark hint): (none — no source-anchored annotations)");
  } else {
    lines.push("- locator windows (per-mark hint, already deduped/merged):");
    for (const w of windows) lines.push(`    ${w.file}:[${w.start}-${w.end}]`);
  }
  const whole = wholePaperFiles(bundle);
  if (whole.length === 0) {
    lines.push("- whole-paper read list: (none indexed)");
  } else {
    lines.push(
      "- whole-paper read list (Read all of these in one parallel batch — the per-mark windows above are only locator hints):",
    );
    for (const p of whole) lines.push(`    ${p}`);
  }
  lines.push("- delimiter collisions: none (bundle-builder enforces this at export)");
  return `${lines.join("\n")}\n`;
}

function formatLabel(entrypoint) {
  const ext = entrypoint.slice(entrypoint.lastIndexOf(".") + 1);
  if (ext === "tex") return "latex";
  if (ext === "md") return "markdown";
  if (ext === "typ") return "typst";
  return "";
}

// Mirrors preflight.rs::source_windows — ±50 lines around each source anchor,
// merged within 100 lines, sorted by file then start.
function sourceWindows(bundle) {
  const byFile = new Map();
  for (const ann of bundle.annotations) {
    if (ann.anchor.kind !== "source") continue;
    const start = Math.max(1, ann.anchor.lineStart - 50);
    const end = ann.anchor.lineEnd + 50;
    const arr = byFile.get(ann.anchor.file) ?? [];
    arr.push([start, end]);
    byFile.set(ann.anchor.file, arr);
  }
  const out = [];
  for (const file of [...byFile.keys()].sort()) {
    const spans = (byFile.get(file) ?? []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [s, e] of spans) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1] + 100) {
        last[1] = Math.max(last[1], e);
        continue;
      }
      merged.push([s, e]);
    }
    for (const [s, e] of merged) out.push({ file, start: s, end: e });
  }
  return out;
}

function wholePaperFiles(bundle) {
  const files = bundle.project.files ?? [];
  return files
    .filter((f) => f.format === "tex" || f.format === "md" || f.format === "typ")
    .map((f) => f.relPath)
    .sort();
}

// The path sanitiser lives in scripts/lib/sanitize-metrics.mjs — the single,
// unit-tested home for the OSS-readability gate. capture-metrics.mjs imports
// `sanitizeLine` / `leaksMachinePath` from there directly.

// Read a fixture's entrypoint source. Returns { entrypointRelPath, sourceText }.
// The fixture dir is a paper root; the entrypoint is its main source file.
export function loadFixtureEntrypoint(fixtureDir, entrypointRelPath) {
  const abs = `${fixtureDir}/${entrypointRelPath}`;
  const sourceText = readFileSync(abs, "utf8");
  return { entrypointRelPath: basename(abs), sourceText };
}
