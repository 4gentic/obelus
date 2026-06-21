#!/usr/bin/env -S npx tsx
// biome-ignore-all lint/suspicious/noConsole: CLI script — stdout is the reporting surface.
//
// Repeatable measurement-capture harness for the perf/scalability overhaul.
// Runs ONE review at N marks against a chosen fixture for a chosen engine and
// emits a sanitized `docs/metrics/<date>-<label>.jsonl` snapshot conforming to
// the `MetricEvent` discriminated union in apps/desktop/src/lib/metrics.ts.
//
// Why a separate harness from scripts/plugin-e2e.mjs: the committed baselines
// are NOT produced by the e2e suite. The e2e harness spawns `claude` with
// `--output-format json` (one terminal blob), which the metrics pipeline can't
// read. The desktop spawns with `--output-format stream-json` and feeds each
// stdout line through the `MetricsStream` parser. This harness reproduces the
// desktop spawn shape (claude_session.rs) and the desktop emit sequence
// (review-runner.tsx + jobs-listener.tsx), reusing the SAME MetricsStream and
// the SAME bundle/plan Zod schemas — no duplicated contract.
//
// === N-marks generation ===
// Programmatic annotation synthesis (see scripts/lib/capture-bundle.mjs). We
// read the fixture's markdown source, pick N prose spans spread across the
// document, and emit N source-anchored annotations cycling the real editorial
// category vocabulary, then build the bundle with the production `buildBundle`.
// Synthesis (rather than a hand-authored bundle per N) is what lets one fixture
// serve a whole sub-range of the gradient with no new files: (a) any N is a
// loop, not a checked-in artifact; (b) source anchors are deterministic and
// need no PDF coordinate math; (c) it drives the same apply-revision → plan-fix
// path a real writer review takes. The two fixtures (small ≈8 spans, large ≈52)
// exist only to give realistic span density at each end of the gradient — small
// for 1–7 marks, large for 12–25. Synthesized ids are deterministic, so two
// snapshots at the same (fixture, N) differ only in the timings that changed.
//
// === Sanitization ===
// Every emitted line is rewritten longest-prefix-first: workspace dir →
// <workspace>, repo root → <obelus-repo>, paper root → <paper-root>, then a
// catch-all /Users|/home/<name> → <home> sweep. A hard gate refuses to write
// the snapshot if any line still leaks a machine path. Session UUIDs are kept
// (not path leaks; keeps the JSONL internally consistent).
//
// === Run a single capture ===
//   pnpm capture:metrics --engine claude   --fixture small --marks 7  --label 7marks-baseline
//   pnpm capture:metrics --engine opencode --fixture small --marks 12 --label 12marks-opencode
//
// === Dry self-test (no engine spawned, spends no quota) ===
//   pnpm capture:metrics --dry-run
//
// See docs/metrics/README.md for the full gradient and auth/quota notes.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
// Workspace TS imported by relative path so `tsx` resolves the sources
// directly (matches scripts/render-prompt-fragments.mjs). These pull the SAME
// MetricEvent / Bundle / PlanFile Zod contracts and the SAME MetricsStream the
// desktop uses — no hand-typed duplicates.
import { MetricEvent, PLAN_STATS_CATEGORIES } from "../apps/desktop/src/lib/metrics.ts";
import { MetricsStream } from "../apps/desktop/src/lib/metrics-stream.ts";
import { Bundle } from "../packages/bundle-schema/src/index.ts";
import {
  PlanFileSchema,
  parseStreamLine,
  pickLatestPlanName,
} from "../packages/claude-sidecar/src/index.ts";
import {
  anchorResolutionFields,
  bundleStatsFields,
  loadFixtureEntrypoint,
  planStatsFields,
  renderPrelude,
  synthesizeBundle,
} from "./lib/capture-bundle.mjs";
import { openCodePrompt } from "./lib/opencode-prompt.mjs";
import { leaksMachinePath, orderReplacements, sanitizeLine } from "./lib/sanitize-metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const pluginDir = resolve(repoRoot, "packages/claude-plugin");
const metricsDir = resolve(repoRoot, "docs/metrics");

const TIMEOUT_MS = 900_000;

// Known fixtures. `small` is the shared sample paper (~8 reviewable spans, the
// right size for 1–7 mark captures). `large` is the 15-section survey
// (~52 prose spans) for the top of the capture gradient. Anything else is
// treated as a path to the reviewer's own paper dir.
const FIXTURES = {
  small: {
    dir: resolve(pluginDir, "fixtures/sample"),
    entrypoint: "sample.md",
    title: "On the Scalability of Transformer Attention",
  },
  large: {
    dir: resolve(pluginDir, "fixtures/sample-large"),
    entrypoint: "sample.md",
    title: "The Scalability of Transformer Attention: A Critical Survey of Long-Context Mechanisms",
  },
};

function parseArgs(argv) {
  const opts = {
    engine: "claude",
    fixture: "small",
    marks: 7,
    label: null,
    out: metricsDir,
    thoroughness: "normal",
    model: "sonnet",
    effort: "low",
    dryRun: false,
    keepTmp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) fail(`flag ${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === "--engine") opts.engine = next();
    else if (a === "--fixture") opts.fixture = next();
    else if (a === "--marks") opts.marks = Number.parseInt(next(), 10);
    else if (a === "--label") opts.label = next();
    else if (a === "--out") opts.out = resolve(next());
    else if (a === "--thoroughness") opts.thoroughness = next();
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--keep-tmp") opts.keepTmp = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else fail(`unknown flag ${a}`);
  }
  if (opts.engine !== "claude" && opts.engine !== "opencode") {
    fail(`--engine must be "claude" or "opencode", got ${JSON.stringify(opts.engine)}`);
  }
  if (!Number.isInteger(opts.marks) || opts.marks < 1) {
    fail(`--marks must be a positive integer, got ${JSON.stringify(opts.marks)}`);
  }
  if (!(opts.thoroughness in THOROUGHNESS)) {
    fail(`--thoroughness must be "normal" or "deep", got ${JSON.stringify(opts.thoroughness)}`);
  }
  opts.model = THOROUGHNESS[opts.thoroughness].model;
  opts.effort = THOROUGHNESS[opts.thoroughness].effort;
  return opts;
}

// Matches the desktop's THOROUGHNESS_SPAWN: "normal" is the sonnet/low default
// the committed baselines were captured at; "deep" is opus/high. Only affects
// the claude engine — OpenCode's model is fixed by its own auth/config.
const THOROUGHNESS = {
  normal: { model: "sonnet", effort: "low" },
  deep: { model: "opus", effort: "high" },
};

function printHelp() {
  console.log(
    [
      "capture-metrics — emit a sanitized review-session metrics snapshot.",
      "",
      "  --engine    claude | opencode               (default claude)",
      "  --fixture   small | large | <abs path to dir> (default small)",
      "  --marks     N (positive integer)            (default 7)",
      "  --label        <slug>  names the output file <date>-<label>.jsonl",
      "  --out          <dir>   output dir (default docs/metrics)",
      "  --thoroughness normal | deep   (default normal = sonnet/low)",
      "  --dry-run   build + validate + sanitize-check; do NOT spawn an engine",
      "  --keep-tmp  keep the scratch project/workspace dirs for inspection",
      "",
      "Dry self-test:  pnpm capture:metrics --dry-run",
    ].join("\n"),
  );
}

function fail(msg) {
  console.error(`[capture] ${msg}`);
  process.exit(2);
}

function resolveFixture(name) {
  if (name in FIXTURES) {
    const f = FIXTURES[name];
    if (!existsSync(resolve(f.dir, f.entrypoint))) {
      fail(`fixture "${name}" entrypoint missing at ${resolve(f.dir, f.entrypoint)}`);
    }
    return f;
  }
  // Treat as a path to a paper dir; require an obvious entrypoint.
  const dir = resolve(name);
  if (!existsSync(dir)) fail(`fixture path does not exist: ${dir}`);
  const entry = ["main.typ", "main.tex", "sample.tex", "sample.md", "sample.typ", "paper.tex"].find(
    (e) => existsSync(resolve(dir, e)),
  );
  if (!entry) {
    fail(`could not find an entrypoint (main.{typ,tex} / sample.* / paper.tex) in ${dir}`);
  }
  return { dir, entrypoint: entry, title: "Captured paper" };
}

// Assemble the bundle + the prompt the desktop would build for a writer-fast /
// rigorous review. Returns everything the spawn and the boundary events need.
function assembleRun(opts) {
  const fixture = resolveFixture(opts.fixture);
  const { entrypointRelPath, sourceText } = loadFixtureEntrypoint(fixture.dir, fixture.entrypoint);
  const projectId = randomUUID();
  const paperId = randomUUID();
  const bundle = synthesizeBundle({
    entrypointRelPath,
    sourceText,
    markCount: opts.marks,
    paperTitle: fixture.title,
    projectLabel: "capture",
    projectId,
    paperId,
  });
  // MetricEvent / PlanFile are the wire contracts; validate the bundle through
  // its own builder (already done inside synthesizeBundle via buildBundle).
  const rawJson = `${JSON.stringify(bundle, null, 2)}\n`;
  return { fixture, entrypointRelPath, bundle, rawJson, projectId, paperId };
}

// Mirror claude_session.rs: rigorous → apply-revision, with the tool-policy
// clause, then the prelude. The bundle path is absolute (workspace-relative on
// the desktop; here the workspace IS the bundle's dir).
function buildClaudePrompt(bundleAbs, workspaceAbs, prelude) {
  const invocation =
    `/obelus:apply-revision ${bundleAbs}\n` +
    `Tool policy for this run: write only inside $OBELUS_WORKSPACE_DIR (${workspaceAbs}). ` +
    "Do NOT use Edit, Write, or any tool that mutates a source file under the project working tree — " +
    "the desktop UI applies plans. If you conclude the bundle's edits are already in the working tree, " +
    "STILL invoke plan-fix with every block ambiguous:true and a reviewer note explaining the no-op; " +
    "every run must end with `OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json`.\n";
  return `${invocation}\n${prelude}`;
}

function preflightEngine(engine) {
  if (engine === "opencode") {
    const probe = spawnSync("opencode", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) {
      fail("opencode CLI not found on PATH. Install: brew install sst/tap/opencode");
    }
    return;
  }
  const probe = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    fail("claude CLI not found on PATH. Install: npm i -g @anthropic-ai/claude-code");
  }
}

// Stages the plugin skills + the OpenCode subagent so OpenCode discovers them,
// mirroring scripts/plugin-e2e.mjs::stageOpenCodeResources and the desktop's
// opencode_session.rs::stage_opencode_resources.
function stageOpenCodeResources(projectDir) {
  const skillsDst = resolve(projectDir, ".claude", "skills");
  if (existsSync(skillsDst)) rmSync(skillsDst, { recursive: true, force: true });
  mkdirSync(dirname(skillsDst), { recursive: true });
  cpSync(resolve(pluginDir, "skills"), skillsDst, { recursive: true });
  const agentDst = resolve(projectDir, ".opencode", "agents", "paper-reviewer.md");
  mkdirSync(dirname(agentDst), { recursive: true });
  cpSync(resolve(pluginDir, "agents", "paper-reviewer.opencode.md"), agentDst);
}

// Spawn the engine the desktop way and stream stdout line-by-line into a
// MetricsStream. Resolves with { events, planPath, exitCode }.
function runEngine(run, opts, scratch) {
  return new Promise((resolvePromise) => {
    const { projectDir, workspaceDir, bundleAbs } = scratch;
    const sessionId = randomUUID();
    const startedAt = Date.now();
    const stream = new MetricsStream({
      sessionId,
      startedAt,
      startedAtIso: new Date(startedAt).toISOString(),
    });
    const events = [];
    const drainInto = () => {
      for (const e of stream.drain()) events.push(e);
    };

    const planFixSkill = resolve(pluginDir, "skills", "plan-fix", "SKILL.md");
    const prelude = renderPrelude(run.bundle, planFixSkill);

    let bin;
    let args;
    let stdinData = null;
    const env = { ...process.env, OBELUS_WORKSPACE_DIR: workspaceDir };

    if (opts.engine === "opencode") {
      stageOpenCodeResources(projectDir);
      const claudeShaped = `/obelus:apply-revision ${bundleAbs}`;
      bin = "opencode";
      args = ["run", "--dir", projectDir, "--dangerously-skip-permissions", "--format", "json"];
      // OpenCode takes the prompt as a positional arg (no stdin prompt path).
      args.push(`${openCodePrompt(claudeShaped)}\n\n${prelude}`);
    } else {
      bin = "claude";
      args = [
        "--print",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--add-dir",
        projectDir,
        "--add-dir",
        workspaceDir,
        "--allowedTools",
        "Read",
        "Glob",
        "Grep",
        "Write",
        "Edit",
        "--model",
        opts.model,
        "--effort",
        opts.effort,
        "--plugin-dir",
        pluginDir,
      ];
      // The desktop pipes the prompt to claude's stdin (spawn_common.rs).
      stdinData = buildClaudePrompt(bundleAbs, workspaceDir, prelude);
    }

    console.log(`[capture] spawn: ${bin} (engine=${opts.engine}, marks=${opts.marks})`);
    const child = spawn(bin, args, { cwd: projectDir, env });
    const timer = setTimeout(() => {
      console.error(`[capture] timeout after ${TIMEOUT_MS}ms — killing ${bin}`);
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const atMs = Date.now();
      stream.ingest(parseStreamLine(line), atMs, new Date(atMs).toISOString());
      drainInto();
    });
    let stderrTail = "";
    child.stderr.on("data", (d) => {
      stderrTail = `${stderrTail}${d}`.slice(-2000);
    });

    if (stdinData !== null) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    child.on("close", (code) => {
      clearTimeout(timer);
      const atMs = Date.now();
      stream.finalize(atMs, new Date(atMs).toISOString());
      drainInto();
      const planNames = existsSync(workspaceDir)
        ? readdirSync(workspaceDir).filter((e) => e.startsWith("plan-") && e.endsWith(".json"))
        : [];
      const latest = pickLatestPlanName(planNames);
      const planPath = latest ? resolve(workspaceDir, latest) : null;
      if (code !== 0) {
        console.error(`[capture] ${bin} exited ${code}. stderr tail:\n${stderrTail.trim()}`);
      }
      resolvePromise({ sessionId, startedAt, events, planPath, exitCode: code ?? 0 });
    });
  });
}

// Build the full ordered event list: boundary events (bundle-validated,
// bundle-stats, preflight-rust, anchor-resolution) → stream events → plan-stats.
// Mirrors the desktop emit order. `validationMs`/`preludeMs`/`sha256Ms` are
// measured locally (the harness validates the bundle and renders the prelude
// itself); they stand in for the Rust preflight timings the desktop emits.
function assembleEvents(run, engineResult, timings) {
  const { sessionId } = engineResult;
  const iso = (ms) => new Date(ms).toISOString();
  const at = iso(engineResult.startedAt);

  const ordered = [];
  ordered.push({
    event: "bundle-validated",
    at,
    sessionId,
    validationMs: timings.validationMs,
    errorCount: 0,
  });
  const stats = bundleStatsFields(run.bundle, run.rawJson);
  ordered.push({
    event: "bundle-stats",
    at,
    sessionId,
    ...stats,
    model: timings.model,
    effort: timings.effort,
  });
  ordered.push({
    event: "preflight-rust",
    at,
    sessionId,
    preludeMs: timings.preludeMs,
    sha256Ms: 0,
    totalMs: timings.preludeMs,
  });
  const anchors = anchorResolutionFields(run.bundle);
  ordered.push({ event: "anchor-resolution", at, sessionId, ...anchors });

  for (const e of engineResult.events) ordered.push(e);

  if (engineResult.planPath && existsSync(engineResult.planPath)) {
    const parsed = PlanFileSchema.safeParse(
      JSON.parse(readFileSync(engineResult.planPath, "utf8")),
    );
    if (parsed.success) {
      const ps = planStatsFields(parsed.data, PLAN_STATS_CATEGORIES);
      ordered.push({ event: "plan-stats", at: iso(Date.now()), sessionId, ...ps });
    } else {
      console.warn(
        `[capture] plan JSON failed PlanFile schema (${parsed.error.issues.length} issues); no plan-stats emitted`,
      );
    }
  } else if (!engineResult.dryRun) {
    console.warn("[capture] no plan-*.json in workspace; snapshot stops before plan-stats");
  }
  return ordered;
}

// Validate every event through the MetricEvent union (the on-disk contract),
// serialize, sanitize, and gate on path leaks. `replacements` is an unordered
// `[absPath, placeholder][]`; we order it longest-prefix-first so a workspace
// nested under the repo root is not half-rewritten. `extraTokens` sweeps
// non-path identity strings (hostname). Returns the sanitized JSONL.
function serializeSnapshot(events, replacements, extraTokens = []) {
  const ordered = orderReplacements(replacements);
  const lines = [];
  for (const ev of events) {
    const parsed = MetricEvent.safeParse(ev);
    if (!parsed.success) {
      fail(
        `internal: assembled a non-conforming MetricEvent (${ev.event}): ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    lines.push(sanitizeLine(JSON.stringify(parsed.data), ordered, extraTokens));
  }
  const leak = lines.find((l) => leaksMachinePath(l, extraTokens));
  if (leak) {
    fail(`refusing to write: a line still leaks a machine path after sanitization:\n  ${leak}`);
  }
  return `${lines.join("\n")}\n`;
}

// Operator identity tokens to sweep from any non-path position (hostname). The
// login name is not swept on its own — it is frequently a common English word
// and would over-redact; it only matters inside a path, which the home-dir
// fallback already collapses to <home>.
function identityTokens() {
  const tokens = [];
  const host = hostname();
  if (host) {
    tokens.push(host);
    const short = host.split(".")[0];
    if (short && short !== host) tokens.push(short);
  }
  return tokens.filter((t, i, a) => t.length > 0 && a.indexOf(t) === i);
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setupScratch(run) {
  const root = resolve(tmpdir(), `obelus-capture-${randomUUID().slice(0, 8)}`);
  const projectDir = resolve(root, "paper");
  const workspaceDir = resolve(root, "workspace");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  // Stage the fixture source(s) into the project dir so the engine can Read them.
  cpSync(run.fixture.dir, projectDir, { recursive: true });
  // The bundle lives in the workspace (OBELUS_WORKSPACE_DIR), as on the desktop.
  const bundleAbs = resolve(workspaceDir, `bundle-${dateStamp().replace(/-/g, "")}.json`);
  writeFileSync(bundleAbs, run.rawJson);
  return { root, projectDir, workspaceDir, bundleAbs };
}

// --- dry self-test: no engine, no quota ---
function dryRun(opts) {
  console.log("[capture] dry-run: building bundle, validating events, checking sanitizer\n");
  const run = assembleRun(opts);

  // 1. Fixture located + N marks synthesized.
  const markCount = run.bundle.annotations.length;
  assert(markCount === opts.marks, `expected ${opts.marks} marks, synthesized ${markCount}`);
  assert(
    run.bundle.annotations.every((a) => a.anchor.kind === "source"),
    "all synthesized anchors must be source-kind",
  );
  console.log(`  ✓ fixture "${opts.fixture}" → ${markCount} source-anchored marks`);

  // 2. Boundary events conform to the MetricEvent union.
  const sessionId = randomUUID();
  const fakeResult = { sessionId, startedAt: Date.now(), events: [], planPath: null, dryRun: true };
  const events = assembleEvents(run, fakeResult, {
    validationMs: 3,
    preludeMs: 4,
    model: "sonnet",
    effort: "low",
  });
  const boundary = events.filter((e) =>
    ["bundle-validated", "bundle-stats", "preflight-rust", "anchor-resolution"].includes(e.event),
  );
  for (const ev of boundary) {
    const parsed = MetricEvent.safeParse(ev);
    assert(
      parsed.success,
      `boundary event ${ev.event} failed MetricEvent: ${JSON.stringify(parsed.success ? "" : parsed.error.issues)}`,
    );
  }
  const statsEv = boundary.find((e) => e.event === "bundle-stats");
  assert(statsEv.annotations === opts.marks, "bundle-stats.annotations must equal mark count");
  assert(statsEv.anchorSource === opts.marks, "bundle-stats.anchorSource must equal mark count");
  console.log(`  ✓ ${boundary.length} boundary events conform to MetricEvent`);

  // 3. plan-stats synthesis from a representative plan.
  const samplePlan = {
    bundleId: "b",
    format: "latex",
    entrypoint: run.entrypointRelPath,
    blocks: [
      {
        annotationIds: [run.bundle.annotations[0].id],
        file: run.entrypointRelPath,
        category: "wrong",
        patch: "@@ -1,2 +1,2 @@\n-a\n+b\n",
        ambiguous: false,
        reviewerNotes: "",
      },
      {
        annotationIds: ["cascade-0001"],
        file: run.entrypointRelPath,
        category: "rephrase",
        patch: "@@ -3,1 +3,1 @@\n-c\n+d\n",
        ambiguous: false,
        reviewerNotes: "Cascaded from the mark above.",
      },
    ],
  };
  const ps = planStatsFields(samplePlan, PLAN_STATS_CATEGORIES);
  assert(ps.blocks === 2, "plan-stats blocks");
  assert(
    ps.byCategory.wrong === 1 && ps.byCategory.cascade === 1,
    "plan-stats byCategory bucketing",
  );
  assert(ps.avgDiffLines === 4, `plan-stats avgDiffLines expected 4, got ${ps.avgDiffLines}`);
  const psParsed = MetricEvent.safeParse({
    event: "plan-stats",
    at: new Date().toISOString(),
    sessionId,
    ...ps,
  });
  assert(psParsed.success, "plan-stats event must conform to MetricEvent");
  console.log("  ✓ plan-stats derivation matches jobs-listener and conforms to MetricEvent");

  // 4. Sanitizer scrubs a representative machine path.
  const sample = JSON.stringify({
    event: "tool-call",
    input:
      '{"file_path":"/Users/realname/Library/Application Support/app.obelus.desktop/projects/x/bundle.json"}',
    repo: "/Users/realname/Projects/4gentic/obelus/apps/desktop",
  });
  const replacements = orderReplacements([
    ["/Users/realname/Library/Application Support/app.obelus.desktop/projects/x", "<workspace>"],
    ["/Users/realname/Projects/4gentic/obelus", "<obelus-repo>"],
  ]);
  const scrubbed = sanitizeLine(sample, replacements, ["realname-laptop.local"]);
  assert(scrubbed.includes("<workspace>"), "sanitizer must apply <workspace>");
  assert(scrubbed.includes("<obelus-repo>"), "sanitizer must apply <obelus-repo>");
  assert(!leaksMachinePath(scrubbed), `sanitizer left a leak: ${scrubbed}`);
  // Catch-all sweep on an unmapped home path + a hostname token.
  const swept = sanitizeLine(
    '{"p":"/Users/someoneelse/secret","host":"box.local"}',
    [],
    ["box.local"],
  );
  assert(!leaksMachinePath(swept, ["box.local"]), "catch-all home + host sweep must scrub");
  assert(swept.includes("<host>"), "host token must be swept to <host>");
  console.log("  ✓ sanitizer scrubs mapped prefixes, unmapped home dirs, and host tokens");

  // 5. The full serialize path validates + gates (real home/host tokens swept).
  serializeSnapshot(
    events,
    [
      [run.fixture.dir, "<paper-root>"],
      [repoRoot, "<obelus-repo>"],
    ],
    identityTokens(),
  );
  console.log("  ✓ end-to-end serialize+gate passes on the assembled snapshot\n");

  console.log("[capture] dry-run: all self-tests passed.");
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.dryRun) {
    dryRun(opts);
    return;
  }

  if (!opts.label) fail("a real capture needs --label <slug> (or pass --dry-run)");
  preflightEngine(opts.engine);

  const run = assembleRun(opts);
  const scratch = setupScratch(run);
  console.log(`[capture] scratch: ${scratch.root}`);

  // Re-parse the serialized bundle through the schema to produce an honest
  // `validationMs` — the desktop's Rust path does the same JSON-Schema check
  // before spawning. (`buildBundle` already validated the in-memory shape;
  // this times the from-bytes round-trip the metric reports.)
  const tValidate = performance.now();
  const validated = Bundle.safeParse(JSON.parse(run.rawJson));
  const validationMs = Math.round(performance.now() - tValidate);
  if (!validated.success) {
    fail(
      `internal: synthesized bundle failed Bundle schema: ${validated.error.issues.length} issues`,
    );
  }
  const tPrelude = performance.now();
  renderPrelude(run.bundle, resolve(pluginDir, "skills", "plan-fix", "SKILL.md"));
  const preludeMs = Math.round(performance.now() - tPrelude);

  const engineResult = await runEngine(run, opts, scratch);
  const events = assembleEvents(run, engineResult, {
    validationMs,
    preludeMs,
    model: opts.engine === "claude" ? opts.model : "opencode",
    effort: opts.engine === "claude" ? opts.effort : "n/a",
  });

  const replacements = [
    [scratch.workspaceDir, "<workspace>"],
    [scratch.projectDir, "<paper-root>"],
    [scratch.root, "<paper-root>"],
    [repoRoot, "<obelus-repo>"],
  ];
  const jsonl = serializeSnapshot(events, replacements, identityTokens());

  mkdirSync(opts.out, { recursive: true });
  const outPath = resolve(opts.out, `${dateStamp()}-${opts.label}.jsonl`);
  writeFileSync(outPath, jsonl);

  const phases = events.filter((e) => e.event === "phase").length;
  const tools = events.filter((e) => e.event === "tool-call" || e.event === "task-call").length;
  console.log(
    `\n[capture] wrote ${outPath}\n  events=${events.length} phases=${phases} tool/task-calls=${tools} marks=${opts.marks} engine=${opts.engine}`,
  );
  if (!engineResult.planPath) {
    console.log("  note: no plan file was produced — inspect the scratch workspace if unexpected.");
  }

  if (!opts.keepTmp) {
    rmSync(scratch.root, { recursive: true, force: true });
  } else {
    console.log(`  --keep-tmp: scratch preserved at ${scratch.root}`);
  }
}

main().catch((err) => {
  console.error("[capture] fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
