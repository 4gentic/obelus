#!/usr/bin/env -S npx tsx
// biome-ignore-all lint/suspicious/noConsole: CLI script — stdout is the reporting surface.
//
// Review-QUALITY evaluation harness (plan track).
//
// Scores the editorial OUTPUT of a plan-fix run — the diffs and reviewerNotes —
// against an LLM-judge rubric grounded in Obelus's OWN criteria (the plan-fix
// and paper-reviewer skills), with methodology that controls for BOTH the
// review's output variance (n>=3 review repeats) and the judge's variance (k=3
// judge passes, per-dimension median).
//
// === Scope: HAND-AUTHORED bundles, never synthetic marks ===
// The latency harness (scripts/capture-metrics.mjs) synthesises generic marks
// ("Capture mark (rephrase): …", empty context) — fine for timing, USELESS for
// quality (there is no editorial intent to satisfy). This harness runs ONLY
// against the hand-authored fixture bundles whose marks carry real notes:
//   * (small, md)  → fixtures/sample/bundle-md.json        — 2 substantive marks
//   * (large, md)  → fixtures/sample-large/bundle-md.json  — 2 substantive marks
//   * (small, full)→ fixtures/sample/bundle.json           — mixed anchors *
//   * (large, full)→ fixtures/sample-large/bundle.json     — mixed anchors *
// The matching fixture source is staged into the scratch project (as
// capture-metrics already does), so a block's patch can be matched back to the
// real source to reconstruct its span.
//   * The `md` variants are the canonical quality targets: every mark is
//     source-anchored against the staged `sample.md`. The `full` variants carry
//     PDF/HTML-anchored marks against source files that do not exist in the
//     text-only staged project (main.tex, notes/intro.tex, preview.html); those
//     marks may resolve `ambiguous`. Default is `--bundle md`.
//
// === Flow ===
//   resolve bundle → setupScratch (stage fixture + write bundle) →
//   runEngine (reuse capture-metrics' desktop-shaped spawn, --keep-tmp) → plan →
//   extractPlan (join marks, reconstruct spans, mechanical coverage) →
//   judge (k=3 per block B1–B6 + plan P1–P4, median) → aggregate →
//   emit quality-block / quality-plan / quality-run through the SAME sanitizer
//   gate as capture-metrics → docs/metrics/<date>-quality-<fixture>-<bundle>-<reviewModel>-r<n>.jsonl
//
// === Run ===
//   pnpm eval:quality --fixture small --bundle md --runs 3 --judge opus
//   pnpm eval:quality:selftest      # = --dry-run, no quota, no engine, no judge
//
// See docs/metrics/quality-eval-design.md for the methodology and
// scripts/lib/judge.mjs for the exact rubric prompts.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { MetricEvent } from "../apps/desktop/src/lib/metrics.ts";
import {
  buildCitationIndex,
  extractCitationKeys,
  extractSections,
  isStructuredSourceFormat,
  scopeForLine,
} from "../packages/bundle-builder/src/index.ts";
import { Bundle } from "../packages/bundle-schema/src/index.ts";
import { PlanFileSchema } from "../packages/claude-sidecar/src/index.ts";
import {
  dateStamp,
  identityTokens,
  pluginDir,
  repoRoot,
  runEngine,
  serializeSnapshot,
  setupScratch,
} from "./capture-metrics.mjs";
import { coverageLevel, extractPlan } from "./lib/eval-extract.mjs";
import {
  computeOverall,
  DEFAULT_JUDGE_MODEL,
  GATING_BLOCK_DIMS,
  scoreBlock,
  scorePlanLevel,
} from "./lib/judge.mjs";

const metricsDir = resolve(repoRoot, "docs/metrics");

// Hand-authored bundle catalogue. Each entry names the fixture dir, the staged
// entrypoint, the paper title, and — per `--bundle` variant — the bundle file
// to score against. The `md` variant is all-source-anchored (canonical); the
// `full` variant is the mixed-anchor bundle.
const FIXTURES = {
  small: {
    dir: resolve(pluginDir, "fixtures/sample"),
    entrypoint: "sample.md",
    title: "On the Scalability of Transformer Attention",
    bundles: {
      md: "bundle-md.json",
      full: "bundle.json",
    },
  },
  large: {
    dir: resolve(pluginDir, "fixtures/sample-large"),
    entrypoint: "sample.md",
    title: "The Scalability of Transformer Attention: A Critical Survey of Long-Context Mechanisms",
    bundles: {
      md: "bundle-md.json",
      full: "bundle.json",
    },
  },
};

const THOROUGHNESS = { model: "sonnet", effort: "low" };

function fail(msg) {
  console.error(`[eval-quality] ${msg}`);
  process.exit(2);
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const opts = {
    fixture: "small",
    bundle: "md",
    runs: 3,
    judge: DEFAULT_JUDGE_MODEL,
    passes: 3,
    out: metricsDir,
    structure: "off",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) fail(`flag ${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === "--fixture") opts.fixture = next();
    else if (a === "--bundle") opts.bundle = next();
    else if (a === "--runs") opts.runs = Number.parseInt(next(), 10);
    else if (a === "--judge") opts.judge = next();
    else if (a === "--passes") opts.passes = Number.parseInt(next(), 10);
    else if (a === "--out") opts.out = resolve(next());
    else if (a === "--structure") opts.structure = next();
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else fail(`unknown flag ${a}`);
  }
  if (!(opts.fixture in FIXTURES)) {
    fail(`--fixture must be one of ${Object.keys(FIXTURES).join(", ")}, got ${opts.fixture}`);
  }
  if (!(opts.bundle in FIXTURES[opts.fixture].bundles)) {
    fail(`--bundle must be "md" or "full", got ${JSON.stringify(opts.bundle)}`);
  }
  if (opts.structure !== "on" && opts.structure !== "off") {
    fail(`--structure must be "on" or "off", got ${JSON.stringify(opts.structure)}`);
  }
  if (!opts.dryRun && (!Number.isInteger(opts.runs) || opts.runs < 3)) {
    fail(`--runs must be an integer >= 3 (variance discipline), got ${JSON.stringify(opts.runs)}`);
  }
  if (!Number.isInteger(opts.passes) || opts.passes < 1) {
    fail(`--passes must be a positive integer, got ${JSON.stringify(opts.passes)}`);
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "eval-review-quality — score plan-fix editorial output against an LLM-judge rubric.",
      "",
      "  --fixture  small | large            (default small)",
      "  --bundle   md | full                (default md; md = all-source-anchored)",
      "  --runs     N (>=3)  review repeats   (default 3 — review-variance control)",
      "  --judge    <model>  judge model      (default opus; pin across before/after)",
      "  --passes   K (>=1)  judge passes      (default 3 — judge-variance control, median)",
      "  --out      <dir>    output dir        (default docs/metrics)",
      "  --structure on|off  Stage-1A enrichment (default off). on = populate the loaded",
      "                      bundle with project.files[].sections, top-level citations, and",
      "                      per-source-anchor scopeStart/scopeEnd via the bundle-builder",
      "                      extractors BEFORE writing the bundle the review reads. The",
      "                      treatment arm of the structure-aware A/B is this worktree's",
      "                      improved skill + --structure on; the baseline is the captured",
      "                      perf/quality-eval runs (current skill, no structure).",
      "  --dry-run  build + rubric + aggregation self-test; NO engine, NO judge, NO quota",
      "",
      "Dry self-test:  pnpm eval:quality:selftest",
    ].join("\n"),
  );
}

// Resolve + validate the hand-authored bundle for (fixture, bundle). Returns
// { fixture, bundleFile, bundle, rawJson, sourceText, sourceByFile }.
function loadHandAuthoredBundle(opts) {
  const fixture = FIXTURES[opts.fixture];
  const bundleFile = resolve(fixture.dir, fixture.bundles[opts.bundle]);
  if (!existsSync(bundleFile)) fail(`bundle file missing: ${bundleFile}`);
  const rawJson = readFileSync(bundleFile, "utf8");
  const parsed = Bundle.safeParse(JSON.parse(rawJson));
  if (!parsed.success) {
    fail(
      `hand-authored bundle failed Bundle schema (${parsed.error.issues.length} issues): ` +
        parsed.error.issues
          .slice(0, 3)
          .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
          .join("; "),
    );
  }
  const bundle = parsed.data;

  // Stage source: the entrypoint plus any per-file source the bundle references
  // (for span reconstruction across a multi-file bundle). Read what exists in
  // the fixture dir; a referenced file that is absent (the `full` bundle's
  // PDF/HTML source paths) simply has no source to match against → its blocks
  // land as span misses, which the extractor surfaces.
  const entryAbs = resolve(fixture.dir, fixture.entrypoint);
  const sourceText = existsSync(entryAbs) ? readFileSync(entryAbs, "utf8") : "";
  const sourceByFile = new Map();
  const fileSet = new Set([fixture.entrypoint]);
  for (const a of bundle.annotations) {
    if (a.anchor.kind === "source" && a.anchor.file) fileSet.add(a.anchor.file);
  }
  for (const rel of fileSet) {
    const abs = resolve(fixture.dir, rel);
    if (existsSync(abs)) sourceByFile.set(rel, readFileSync(abs, "utf8"));
    // The plan's block.file may be the basename (the staged project flattens
    // the fixture dir); register both forms so the lookup hits.
    if (existsSync(abs)) sourceByFile.set(basename(rel), readFileSync(abs, "utf8"));
  }

  return { fixture, bundleFile, bundle, rawJson, sourceText, sourceByFile };
}

// === Stage-1A structure enrichment (--structure on) =========================
//
// The hand-authored fixture bundles carry no Stage-1A structure: no
// `project.files[].sections`, no top-level `citations`, no per-anchor
// `scopeStart`/`scopeEnd`. The desktop's exporter (`bundle-builder`) fills these
// from source bytes at export time; here we apply the SAME extractors
// (`extractSections` / `extractCitationKeys` / `buildCitationIndex` /
// `scopeForLine`) to an already-parsed bundle so the A/B treatment arm reviews
// against a structure-aware bundle without re-deriving the whole `BuildBundleInput`
// shape. `--structure off` (default) is a no-op → the baseline bundle.
//
// Mutates `loaded.bundle` in place and regenerates `loaded.rawJson` so BOTH the
// on-disk bundle the review reads (written by setupScratch) and the prelude
// (rendered from `run.bundle`) carry the structure. Re-validates through the
// Bundle schema — a structure-enriched bundle that doesn't round-trip is a bug,
// not a soft-failure to paper over.
function fileFormatOf(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf(".") + 1);
  return ext === "tex" || ext === "md" || ext === "typ" ? ext : "other";
}

function enrichWithStructure(loaded) {
  const { bundle, fixture } = loaded;

  // The source files this bundle's source anchors reference, plus the
  // entrypoint. Read each from the fixture dir; absent files (the `full`
  // bundle's PDF/HTML source paths) contribute no structure.
  const fileSet = new Set([fixture.entrypoint]);
  for (const a of bundle.annotations) {
    if (a.anchor.kind === "source" && a.anchor.file) fileSet.add(a.anchor.file);
  }

  // Per-file section map + accumulated citation keys, mirroring
  // bundle-builder's extractStructure. Format comes from project.files[] when
  // present, else from the path extension (the md fixtures carry no inventory).
  const sectionsByFile = new Map();
  const citationKeys = [];
  const filesIndex = new Map((bundle.project.files ?? []).map((f) => [f.relPath, f]));
  for (const rel of fileSet) {
    const abs = resolve(fixture.dir, rel);
    if (!existsSync(abs)) continue;
    const format = filesIndex.get(rel)?.format ?? fileFormatOf(rel);
    if (!isStructuredSourceFormat(format)) continue;
    const text = readFileSync(abs, "utf8");
    const sections = extractSections(text, format);
    if (sections.length > 0) sectionsByFile.set(rel, sections);
    citationKeys.push(...extractCitationKeys(text, format));
  }
  const citations = buildCitationIndex(citationKeys);

  // project.files[] with sections (creating the inventory if the fixture bundle
  // had none — this is what activates the prelude's whole-paper read list too).
  const files = [];
  for (const rel of fileSet) {
    const abs = resolve(fixture.dir, rel);
    if (!existsSync(abs)) continue;
    const existing = filesIndex.get(rel);
    const format = existing?.format ?? fileFormatOf(rel);
    const sections = sectionsByFile.get(rel);
    files.push({
      relPath: rel,
      format,
      ...(existing?.role !== undefined ? { role: existing.role } : {}),
      ...(sections !== undefined ? { sections } : {}),
    });
  }
  // Preserve any inventory files the bundle already listed that aren't source
  // anchors (none in the fixtures today, but don't drop them silently).
  for (const f of bundle.project.files ?? []) {
    if (!files.some((nf) => nf.relPath === f.relPath)) files.push(f);
  }
  bundle.project.files = files;

  // Per-source-anchor scopeStart/scopeEnd from the file's section map, exactly
  // as bundle-builder's withScope does (keyed off lineStart).
  let scopedAnchors = 0;
  for (const a of bundle.annotations) {
    if (a.anchor.kind !== "source") continue;
    const sections = sectionsByFile.get(a.anchor.file);
    if (!sections) continue;
    const scope = scopeForLine(sections, a.anchor.lineStart);
    if (!scope) continue;
    a.anchor.scopeStart = scope.scopeStart;
    a.anchor.scopeEnd = scope.scopeEnd;
    scopedAnchors += 1;
  }

  if (citations.length > 0) bundle.citations = citations;

  // Re-validate + re-serialize: the enriched bundle is what the review reads.
  const reparsed = Bundle.safeParse(bundle);
  if (!reparsed.success) {
    fail(
      `structure-enriched bundle failed Bundle schema (${reparsed.error.issues.length} issues): ` +
        reparsed.error.issues
          .slice(0, 3)
          .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
          .join("; "),
    );
  }
  loaded.bundle = reparsed.data;
  loaded.rawJson = `${JSON.stringify(reparsed.data, null, 2)}\n`;

  let sectionCount = 0;
  for (const s of sectionsByFile.values()) sectionCount += s.length;
  console.info("[eval-quality:structure]", {
    filesWithSections: sectionsByFile.size,
    sectionCount,
    citationKeys: citations.length,
    scopedAnchors,
  });
  return loaded;
}

// Build the `run` shape capture-metrics' setupScratch / runEngine consume,
// from a hand-authored bundle (NOT synthesizeBundle).
function assembleRunFromBundle(loaded) {
  return {
    fixture: loaded.fixture,
    entrypointRelPath: basename(loaded.fixture.entrypoint),
    bundle: loaded.bundle,
    rawJson: loaded.rawJson.endsWith("\n") ? loaded.rawJson : `${loaded.rawJson}\n`,
    projectId: loaded.bundle.project.id,
    paperId: loaded.bundle.papers[0]?.id ?? randomUUID(),
  };
}

// === scoring → quality-* events =============================================

// Score one extraction into quality-block + quality-plan events. `judgeOpts`
// carries { model, passes, runner? }; `runner` is injected by the dry self-test
// to score WITHOUT spawning the judge.
function scoreExtraction(extraction, sourceText, meta, judgeOpts) {
  const at = new Date().toISOString();
  const events = [];
  const scoredBlocks = [];

  for (const block of extraction.blocks) {
    // Score only patched (scorable) blocks per block; flag-notes feed the
    // plan-level dims, not B1–B6.
    if (block.patch === "" || block.ambiguous || block.emptyReason !== null) continue;
    const text = extraction.sourceByFile?.get(block.file) || sourceText || "";
    const scored = scoreBlock(block, text, judgeOpts);
    scoredBlocks.push({ dims: scored.dims, annotationIds: block.annotationIds });
    events.push({
      event: "quality-block",
      at,
      sessionId: meta.sessionId,
      annotationIds: block.annotationIds,
      category: block.category,
      blockKind: block.blockKind,
      dims: scored.dims,
      gated: GATING_BLOCK_DIMS,
      // Rationales are carried for sanitization + truncation, then dropped
      // before the MetricEvent validate (not part of the on-disk schema).
      _why: scored.why,
    });
  }

  const covLvl = coverageLevel(extraction.coverage);
  const planScored = scorePlanLevel(extraction, covLvl, judgeOpts);
  const rolled = computeOverall(scoredBlocks, planScored.dims);

  events.push({
    event: "quality-plan",
    at,
    sessionId: meta.sessionId,
    fixture: meta.fixture,
    bundle: meta.bundle,
    marks: extraction.coverage.substantiveCount,
    dims: planScored.dims,
    overall: rolled.overall,
    coverageDropped: extraction.coverage.dropped,
    _why: planScored.why,
  });

  events.push({
    event: "quality-run",
    at,
    sessionId: meta.sessionId,
    judgeModel: meta.judgeModel,
    judgePasses: meta.judgePasses,
    reviewModel: meta.reviewModel,
    reviewEffort: meta.reviewEffort,
    runIndex: meta.runIndex,
    runsTotal: meta.runsTotal,
  });

  return { events, rolled, coverageLevel: covLvl };
}

// Fold judge rationales into the event's reviewerNotes-adjacent fields, then
// strip the `_why` scratch. Rationales may quote a patch embedding scratch
// paths, so each is truncated to ~200 chars and will additionally pass through
// the path sanitizer at serialize time. We carry rationales into a `_rationale`
// string on the block/plan event? — no: the MetricEvent schema has no such
// field. Instead we DROP `_why` from the emitted event (the score is the
// product; rationales are a debugging aid logged to stdout, sanitized).
function finalizeEvents(events, replacements, tokens) {
  const clean = [];
  for (const ev of events) {
    if (ev._why) {
      // Log a sanitized, truncated rationale digest to stdout for inspection;
      // never let it into the committed JSONL (the schema has no rationale key).
      const digest = Object.fromEntries(
        Object.entries(ev._why).map(([k, v]) => [k, truncate(String(v ?? ""), 200)]),
      );
      console.info(
        `[eval-quality] rationale (${ev.event})`,
        sanitizeForLog(digest, replacements, tokens),
      );
    }
    const { _why, ...rest } = ev;
    clean.push(rest);
  }
  return clean;
}

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// Sanitize a small object's string values for a stdout log line (reuse the
// snapshot sanitizer's path scrubbing by round-tripping through JSON).
function sanitizeForLog(obj, replacements, tokens) {
  // serializeSnapshot validates MetricEvents; for a free-form log digest we
  // just scrub paths via the same vocabulary using a throwaway JSON round-trip.
  const line = JSON.stringify(obj);
  const { sanitizeLine, orderReplacements, expandScratchForms } = sanitizeLib;
  return sanitizeLine(line, orderReplacements(expandScratchForms(replacements)), tokens);
}

// Lazily-imported sanitizer (kept out of the top import block so the dry
// self-test's import graph is obvious). Populated in main().
let sanitizeLib = null;

// === dry self-test (no engine, no judge, no quota) ==========================
async function dryRun(opts) {
  console.log(
    "[eval-quality] dry-run: bundle parse, rubric scoring, gating override, schema, sanitizer\n",
  );

  // 1. The hand-authored bundle parses, and it carries REAL notes (not the
  //    synthetic "Capture mark" filler) — the scope guarantee.
  const loaded = loadHandAuthoredBundle({ ...opts, fixture: "small", bundle: "md" });
  assert(loaded.bundle.annotations.length >= 2, "small/bundle-md must carry >=2 marks");
  assert(
    loaded.bundle.annotations.every((a) => !/^Capture mark \(/.test(a.note)),
    "marks must be hand-authored (real notes), not synthetic capture filler",
  );
  assert(
    loaded.bundle.annotations.some((a) => a.note.includes("production")),
    "expected the hand-authored elaborate note about production systems",
  );
  console.log(
    `  ✓ hand-authored small/bundle-md.json parses: ${loaded.bundle.annotations.length} marks with real notes`,
  );

  // 2. A representative hand-made plan scores through the rubric aggregation,
  //    INCLUDING the B5 gating override capping `overall` at "fail". We inject a
  //    deterministic judge runner so no quota is spent.
  const marks = loaded.bundle.annotations;
  const elaborate = marks.find((m) => m.category === "elaborate");
  const weak = marks.find((m) => m.category === "weak-argument");
  // Two blocks: one clean (good edit, TODO citation → B5=2), one that INVENTS a
  // citation (→ B5=0, gating fail). The source lines they target are the real
  // anchored lines so span reconstruction resolves.
  const lines = loaded.sourceText.split("\n");
  const goodTargetLine = lines[14] ?? ""; // line 15 (elaborate anchor) — full, verbatim
  const weakTargetLine = lines[28] ?? ""; // line 29 (weak-argument anchor) — full, verbatim
  const samplePlan = {
    bundleId: loaded.bundleFile,
    format: "markdown",
    entrypoint: basename(loaded.fixture.entrypoint),
    blocks: [
      {
        annotationIds: [elaborate.id],
        file: basename(loaded.fixture.entrypoint),
        category: "elaborate",
        patch: `@@ -15,1 +15,1 @@\n-${goodTargetLine}\n+${goodTargetLine} Systems such as GPT-4 and Claude truncate long inputs [@TODO].\n`,
        ambiguous: false,
        reviewerNotes:
          "Names concrete production systems and carries a TODO citation placeholder rather than inventing a reference; addresses the elaborate note.",
        emptyReason: null,
      },
      {
        annotationIds: [weak.id],
        file: basename(loaded.fixture.entrypoint),
        category: "weak-argument",
        // A well-formed patch (verbatim `-` line) that INVENTS a citation
        // ("Smith & Jones, 2021") — the B5=0 gating trigger, isolated from any
        // patch-applies confound.
        patch: `@@ -29,1 +29,1 @@\n-${weakTargetLine}\n+${weakTargetLine.replace(/\.$/, "")} (Smith & Jones, 2021, Table 4).\n`,
        ambiguous: false,
        reviewerNotes:
          "Strengthens the claim, but cites a specific source for the benchmark-design argument.",
        emptyReason: null,
      },
    ],
  };
  const planParsed = PlanFileSchema.safeParse(samplePlan);
  assert(
    planParsed.success,
    `sample plan must satisfy PlanFileSchema: ${JSON.stringify(planParsed.success ? "" : planParsed.error.issues)}`,
  );

  const extraction = extractPlan({
    plan: planParsed.data,
    bundle: loaded.bundle,
    sourceText: loaded.sourceText,
    sourceByFile: loaded.sourceByFile,
  });
  extraction.sourceByFile = loaded.sourceByFile;
  // Coverage: both substantive marks got a block → full coverage.
  assert(extraction.coverage.dropped.length === 0, "both substantive marks should be covered");
  assert(coverageLevel(extraction.coverage) === 3, "full coverage → P1 level 3");
  // Both blocks' spans must reconstruct against the real staged source — the
  // patch-context-matching path is exercised end-to-end.
  assert(
    extraction.blocks.every((b) => b.spanResolved),
    "both well-formed blocks' patches must match the staged source (span reconstruction)",
  );
  console.log(
    `  ✓ representative plan extracts: ${extraction.blocks.length} blocks (spans reconstructed), coverage ${extraction.coverage.coveredCount}/${extraction.coverage.substantiveCount}, P1=${coverageLevel(extraction.coverage)}`,
  );

  // Deterministic judge: block 1 (TODO cite) scores clean; block 2 (invented
  // "Smith & Jones, 2021") scores B5=0. Keyed off the prompt content so the
  // runner reacts to the actual edit, not a fixed index.
  const runner = (prompt) => {
    const isPlan = prompt.includes("WHOLE review plan");
    if (isPlan) {
      return JSON.stringify({
        P1: 3,
        P2: 3,
        P3: 3,
        P4: 3,
        why: { P1: "x", P2: "x", P3: "x", P4: "x" },
      });
    }
    const invented = prompt.includes("Smith & Jones");
    const base = { B1: 3, B2: 3, B3: 3, B4: 3, B5: invented ? 0 : 2, B6: 3 };
    return JSON.stringify({
      ...base,
      why: { B5: invented ? "invents a citation" : "uses TODO placeholder" },
    });
  };

  const judgeOpts = { model: "dry", passes: opts.passes, runner };
  const scored = scoreExtraction(
    extraction,
    loaded.sourceText,
    {
      sessionId: randomUUID(),
      fixture: "small",
      bundle: "md",
      judgeModel: "dry",
      judgePasses: opts.passes,
      reviewModel: "sonnet",
      reviewEffort: "low",
      runIndex: 0,
      runsTotal: opts.runs,
    },
    judgeOpts,
  );
  const planEvent = scored.events.find((e) => e.event === "quality-plan");
  assert(
    planEvent.overall === "fail",
    `B5=0 (invented citation) must cap overall at "fail", got ${planEvent.overall}`,
  );
  assert(scored.rolled.inventedCitation === true, "rolled result must flag the invented citation");
  console.log(
    `  ✓ rubric aggregation: invented-citation block → B5=0 → overall "${planEvent.overall}" (gating override holds)`,
  );

  // Counter-check: with BOTH blocks clean (no invented cite), overall is not
  // gated to fail — proving the cap is the citation, not a blanket fail.
  const cleanRunner = (prompt) =>
    prompt.includes("WHOLE review plan")
      ? JSON.stringify({ P1: 3, P2: 3, P3: 3, P4: 3, why: {} })
      : JSON.stringify({ B1: 3, B2: 3, B3: 3, B4: 3, B5: 2, B6: 3, why: {} });
  const cleanScored = scoreExtraction(
    extraction,
    loaded.sourceText,
    {
      sessionId: randomUUID(),
      fixture: "small",
      bundle: "md",
      judgeModel: "dry",
      judgePasses: opts.passes,
      reviewModel: "sonnet",
      reviewEffort: "low",
      runIndex: 0,
      runsTotal: opts.runs,
    },
    { model: "dry", passes: opts.passes, runner: cleanRunner },
  );
  const cleanPlan = cleanScored.events.find((e) => e.event === "quality-plan");
  assert(cleanPlan.overall === "pass", `all-clean plan should pass, got ${cleanPlan.overall}`);
  console.log(
    `  ✓ counter-check: all-clean plan → overall "${cleanPlan.overall}" (cap is the citation, not blanket)`,
  );

  // 3. The new MetricEvent variants validate.
  for (const ev of [...scored.events]) {
    const { _why, ...rest } = ev;
    const parsed = MetricEvent.safeParse(rest);
    assert(
      parsed.success,
      `quality event ${ev.event} must conform to MetricEvent: ${JSON.stringify(parsed.success ? "" : parsed.error.issues)}`,
    );
  }
  console.log("  ✓ quality-block / quality-plan / quality-run conform to the MetricEvent union");

  // 4. The sanitizer scrubs a path embedded in a judge rationale.
  const { sanitizeLine, orderReplacements } = sanitizeLib;
  const rationale = truncate(
    "patch targets /Users/realname/Library/Application Support/app.obelus.desktop/projects/x/plan.json which inlines /Users/realname/papers/p/sample.md so the cite " +
      "x".repeat(300),
    200,
  );
  const scrubbed = sanitizeLine(
    JSON.stringify({ B5: rationale }),
    orderReplacements([
      ["/Users/realname/Library/Application Support/app.obelus.desktop/projects/x", "<workspace>"],
      ["/Users/realname/papers/p", "<paper-root>"],
    ]),
    [],
  );
  assert(
    !sanitizeLib.leaksMachinePath(scrubbed),
    `sanitizer must scrub the rationale path leak: ${scrubbed}`,
  );
  assert(
    scrubbed.includes("<workspace>") || scrubbed.includes("<paper-root>"),
    "rationale paths must map to placeholders",
  );
  console.log(
    "  ✓ sanitizer scrubs a machine path embedded in a judge rationale (truncated to ~200 chars)",
  );

  // 5. End-to-end serialize+gate over the assembled quality events.
  const cleanEvents = finalizeEvents(
    scored.events,
    [
      [loaded.fixture.dir, "<paper-root>"],
      [repoRoot, "<obelus-repo>"],
    ],
    identityTokens(),
  );
  serializeSnapshot(
    cleanEvents,
    [
      [loaded.fixture.dir, "<paper-root>"],
      [repoRoot, "<obelus-repo>"],
    ],
    identityTokens(),
  );
  console.log("  ✓ end-to-end serialize+gate passes on the assembled quality snapshot\n");

  // 6. The --structure A/B switch. The baseline (hand-authored) bundle carries
  //    NO Stage-1A structure; --structure on populates it via the bundle-builder
  //    extractors, and the enriched bundle still validates. This is the
  //    treatment arm's input — assert it actually adds sections + scoped anchors.
  assertStructureSwitch(opts);

  console.log("[eval-quality] dry-run: all self-tests passed.");
}

// Dry proof for `--structure on`: enrichment populates project.files[].sections
// + per-source-anchor scopeStart/scopeEnd (and, where the source cites, the
// top-level citations index), the result round-trips the Bundle schema, and
// each scoped anchor's range encloses its own anchor line. `--structure off`
// stays a no-op (the baseline). Runs for BOTH md fixtures so the small (no
// citations) and large (cited) shapes are both exercised — no engine, no judge.
function assertStructureSwitch(opts) {
  for (const fixtureName of ["small", "large"]) {
    // Baseline: the hand-authored bundle has no structure at all.
    const baseline = loadHandAuthoredBundle({ ...opts, fixture: fixtureName, bundle: "md" });
    assert(
      (baseline.bundle.project.files ?? []).every((f) => f.sections === undefined),
      `${fixtureName}/md baseline must carry no section maps (the A/B precondition)`,
    );
    assert(
      baseline.bundle.annotations.every(
        (a) => a.anchor.kind !== "source" || a.anchor.scopeStart === undefined,
      ),
      `${fixtureName}/md baseline must carry no scoped anchors`,
    );

    // --structure off path: the bundle the review reads is the hand-authored
    // bundle unchanged (enrichWithStructure is never called when off). Capture
    // its serialized form as the baseline to diff the treatment arm against.
    const offRawJson = loadHandAuthoredBundle({
      ...opts,
      fixture: fixtureName,
      bundle: "md",
    }).rawJson;

    // --structure on: enrich and assert real structure landed.
    const enriched = enrichWithStructure(
      loadHandAuthoredBundle({ ...opts, fixture: fixtureName, bundle: "md" }),
    );
    assert(
      enriched.rawJson !== offRawJson,
      `${fixtureName}/md --structure on must change the bundle vs --structure off (enrichment is non-trivial)`,
    );
    const reparsed = Bundle.safeParse(JSON.parse(enriched.rawJson));
    assert(
      reparsed.success,
      `${fixtureName}/md enriched bundle must round-trip the Bundle schema: ${JSON.stringify(reparsed.success ? "" : reparsed.error.issues.slice(0, 2))}`,
    );

    const filesWithSections = (enriched.bundle.project.files ?? []).filter(
      (f) => Array.isArray(f.sections) && f.sections.length > 0,
    );
    assert(
      filesWithSections.length > 0,
      `${fixtureName}/md --structure on must populate at least one file's sections`,
    );

    const sourceAnchors = enriched.bundle.annotations.filter((a) => a.anchor.kind === "source");
    const scopedAnchors = sourceAnchors.filter(
      (a) => a.anchor.scopeStart !== undefined && a.anchor.scopeEnd !== undefined,
    );
    assert(
      scopedAnchors.length === sourceAnchors.length && scopedAnchors.length > 0,
      `${fixtureName}/md --structure on must scope every source anchor (got ${scopedAnchors.length}/${sourceAnchors.length})`,
    );
    // Each scope must actually enclose its anchor line — a scope that doesn't
    // contain lineStart would mis-route the planner's section-bounded edit.
    for (const a of scopedAnchors) {
      assert(
        a.anchor.scopeStart <= a.anchor.lineStart && a.anchor.lineStart <= a.anchor.scopeEnd,
        `${fixtureName}/md scoped anchor must enclose its line (line ${a.anchor.lineStart} not in [${a.anchor.scopeStart}, ${a.anchor.scopeEnd}])`,
      );
    }

    const citationNote =
      (enriched.bundle.citations ?? []).length > 0
        ? `, citations=${enriched.bundle.citations.length}`
        : " (no citations in source — citations omitted, correct)";
    console.log(
      `  ✓ --structure on (${fixtureName}/md): ${filesWithSections.length} file(s) with sections, ${scopedAnchors.length}/${sourceAnchors.length} anchors scoped${citationNote}`,
    );
  }
}

// === real run ===============================================================
async function realRun(opts) {
  // Engine preflight (claude on PATH).
  const loaded = loadHandAuthoredBundle(opts);
  if (opts.structure === "on") enrichWithStructure(loaded);
  console.log(
    `[eval-quality] fixture=${opts.fixture} bundle=${opts.bundle} (${loaded.bundleFile.replace(repoRoot, "<obelus-repo>")}), runs=${opts.runs}, judge=${opts.judge}, passes=${opts.passes}, structure=${opts.structure}`,
  );

  const reviewOpts = {
    engine: "claude",
    fixture: opts.fixture,
    marks: loaded.bundle.annotations.length,
    model: THOROUGHNESS.model,
    effort: THOROUGHNESS.effort,
  };

  for (let runIndex = 0; runIndex < opts.runs; runIndex += 1) {
    const run = assembleRunFromBundle(loaded);
    const scratch = setupScratch(run);
    console.log(`\n[eval-quality] run ${runIndex + 1}/${opts.runs} scratch: ${scratch.root}`);

    let plan = null;
    try {
      const engineResult = await runEngine(run, reviewOpts, scratch);
      if (!engineResult.planPath || !existsSync(engineResult.planPath)) {
        console.warn("[eval-quality] no plan-*.json produced; skipping this run's scoring");
        continue;
      }
      const parsed = PlanFileSchema.safeParse(
        JSON.parse(readFileSync(engineResult.planPath, "utf8")),
      );
      if (!parsed.success) {
        console.warn(
          `[eval-quality] plan failed PlanFileSchema (${parsed.error.issues.length} issues); skipping scoring`,
        );
        continue;
      }
      plan = parsed.data;

      const extraction = extractPlan({
        plan,
        bundle: loaded.bundle,
        sourceText: loaded.sourceText,
        sourceByFile: loaded.sourceByFile,
      });
      extraction.sourceByFile = loaded.sourceByFile;
      const covLvl = coverageLevel(extraction.coverage);

      const meta = {
        sessionId: engineResult.sessionId,
        fixture: opts.fixture,
        bundle: opts.bundle,
        judgeModel: opts.judge,
        judgePasses: opts.passes,
        reviewModel: reviewOpts.model,
        reviewEffort: reviewOpts.effort,
        runIndex,
        runsTotal: opts.runs,
      };
      const scored = scoreExtraction(extraction, loaded.sourceText, meta, {
        model: opts.judge,
        passes: opts.passes,
      });

      const replacements = [
        [scratch.workspaceDir, "<workspace>"],
        [scratch.projectDir, "<paper-root>"],
        [scratch.root, "<paper-root>"],
        [loaded.fixture.dir, "<paper-root>"],
        [repoRoot, "<obelus-repo>"],
      ];
      const tokens = identityTokens();
      const cleanEvents = finalizeEvents(scored.events, replacements, tokens);
      const jsonl = serializeSnapshot(cleanEvents, replacements, tokens);

      mkdirSync(opts.out, { recursive: true });
      const outPath = resolve(
        opts.out,
        `${dateStamp()}-quality-${opts.fixture}-${opts.bundle}-struct-${opts.structure}-${reviewOpts.model}-r${runIndex + 1}.jsonl`,
      );
      writeFileSync(outPath, jsonl);
      console.log(
        `[eval-quality] wrote ${outPath}\n  blocks=${extraction.blocks.length} coverage=${extraction.coverage.coveredCount}/${extraction.coverage.substantiveCount} P1=${covLvl} overall=${scored.rolled.overall}`,
      );
    } finally {
      rmSync(scratch.root, { recursive: true, force: true });
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Populate the sanitizer lib (used by both paths).
  sanitizeLib = await import("./lib/sanitize-metrics.mjs");

  if (opts.dryRun) {
    await dryRun(opts);
    return;
  }
  await realRun(opts);
}

main().catch((err) => {
  console.error("[eval-quality] fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
