#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noConsole: CLI script — stdout is the reporting surface.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const pluginDir = resolve(repo, "packages/claude-plugin");
const fixturesDir = resolve(pluginDir, "fixtures/sample");
const cascadeDir = resolve(pluginDir, "fixtures/cascade");
// Default out-of-repo: otherwise, subscription mode (no --bare) auto-discovers
// the repo's CLAUDE.md by walking up from the scenario cwd.
const tmpRoot = process.env.OBELUS_E2E_TMP_DIR
  ? resolve(process.env.OBELUS_E2E_TMP_DIR)
  : resolve(tmpdir(), "obelus-plugin-e2e");

const BUDGET_USD = "1.00";
const TIMEOUT_MS = 300_000;
const MAX_BUFFER = 16 * 1024 * 1024;

const ONLY_IDS = (process.env.OBELUS_E2E_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// The skills emit refusal prose in two variants — v1 says "Cannot apply this revision"
// (apply-revision/SKILL.md:71); v2 scopes per paper as "I can't apply this revision for ..."
// (apply-revision/SKILL.md:104). Match either.
const REFUSAL_PATTERN = /(?:Cannot|I can't) apply this revision/;
const WRITE_REVIEW_FALLBACK = "/obelus:write-review";

function containsRefusal(text) {
  return REFUSAL_PATTERN.test(text);
}

const scenarios = [
  {
    id: "1.1",
    name: "review-single",
    prompt: "/obelus:write-review ./bundle.json --out",
    stage(dir) {
      cpSync(resolve(fixturesDir, "bundle.json"), resolve(dir, "bundle.json"));
    },
    assert: assertReviewLetter,
  },
  {
    id: "1.2",
    name: "review-with-sources",
    prompt: "/obelus:write-review ./bundle.json --out",
    stage(dir) {
      cpSync(resolve(fixturesDir, "bundle.json"), resolve(dir, "bundle.json"));
      cpSync(resolve(fixturesDir, "sample.tex"), resolve(dir, "sample.tex"));
      cpSync(resolve(fixturesDir, "sample.md"), resolve(dir, "sample.md"));
      cpSync(resolve(fixturesDir, "sample.typ"), resolve(dir, "sample.typ"));
    },
    assert: assertReviewLetter,
  },
  {
    id: "2.1",
    name: "revise-no-sources",
    prompt: "/obelus:apply-revision ./bundle.json",
    stage(dir) {
      cpSync(resolve(fixturesDir, "bundle.json"), resolve(dir, "bundle.json"));
    },
    assert: assertNoSourceRefusal,
  },
  {
    id: "2.2",
    name: "revise-with-sources",
    prompt: "/obelus:apply-revision ./bundle.json",
    stage(dir) {
      cpSync(resolve(fixturesDir, "bundle.json"), resolve(dir, "bundle.json"));
      cpSync(resolve(fixturesDir, "sample.tex"), resolve(dir, "sample.tex"));
    },
    assert: assertPlanWritten,
  },
  cascadeScenario("3.1", "cascade-lexical-terminology", assertLexicalTerminologyCascade),
  cascadeScenario("3.2", "cascade-lexical-numerical", assertLexicalNumericalCascade),
  cascadeScenario("3.3", "cascade-structural-label", assertStructuralLabelCascade),
  cascadeScenario("3.4", "cascade-propositional-iid", assertPropositionalImpact),
  cascadeScenario("3.5", "cascade-vacuous-praise", assertVacuousPhase),
  cascadeScenario("3.6", "cascade-citation-only", assertCitationOnlyNoTrigger),
  cascadeScenario("3.7", "cascade-drift", assertDriftVsCascade),
  cascadeScenario("3.8", "cascade-lexical-morphology", assertLexicalMorphologyCascade),
  cascadeScenario("3.9", "cascade-quality-sweep", assertQualitySweep),
];

function cascadeScenario(id, name, assertFn) {
  const fixtureStem = name.replace(/^cascade-/, "");
  return {
    id,
    name,
    prompt: "/obelus:apply-revision ./bundle.json",
    stage(dir) {
      cpSync(resolve(cascadeDir, `${fixtureStem}.bundle.json`), resolve(dir, "bundle.json"));
      cpSync(resolve(cascadeDir, `${fixtureStem}.tex`), resolve(dir, "paper.tex"));
    },
    assert: assertFn,
  };
}

function assertReviewLetter(result, dir) {
  const stdout = typeof result.result === "string" ? result.result : "";
  if (containsRefusal(stdout)) {
    return { ok: false, reason: "apply-revision refusal appeared in write-review output" };
  }
  // write-review's contract: review body is written to .obelus/writeup-<paper-id>-<iso>.md;
  // stdout carries only the OBELUS_WROTE: marker (and at most a few sentences of narration).
  const planDir = resolve(dir, ".obelus");
  if (!existsSync(planDir)) {
    return { ok: false, reason: ".obelus/ directory not created by write-review" };
  }
  const writeup = readdirSync(planDir).find((e) => e.startsWith("writeup-") && e.endsWith(".md"));
  if (!writeup) {
    return { ok: false, reason: "no writeup-*.md written by write-review" };
  }
  const body = readFileSync(resolve(planDir, writeup), "utf8");
  if (!body.includes("# Review")) {
    return { ok: false, reason: `${writeup} missing \`# Review\` heading` };
  }
  if (!body.includes("On the Scalability of Transformer Attention")) {
    return { ok: false, reason: `${writeup} missing paper title` };
  }
  const tracedCitation = /vaswani/i.test(body);
  const tracedClaim = /production systems/i.test(body);
  if (!tracedCitation && !tracedClaim) {
    return {
      ok: false,
      reason: `${writeup} surfaced neither citation nor unclear-claim annotation`,
    };
  }
  if (!stdout.includes(`OBELUS_WROTE: .obelus/${writeup}`)) {
    return { ok: false, reason: "OBELUS_WROTE: marker missing or does not name the writeup" };
  }
  return { ok: true, reason: `letter well-formed in ${writeup}` };
}

function assertNoSourceRefusal(result, dir) {
  const text = typeof result.result === "string" ? result.result : "";
  if (!containsRefusal(text)) {
    return { ok: false, reason: "expected no-source refusal text not present" };
  }
  if (!text.includes(WRITE_REVIEW_FALLBACK)) {
    return { ok: false, reason: "refusal did not suggest /obelus:write-review fallback" };
  }
  const planDir = resolve(dir, ".obelus");
  if (existsSync(planDir)) {
    const stale = readdirSync(planDir).filter((e) => e.startsWith("plan-"));
    if (stale.length > 0) {
      return { ok: false, reason: `plan file written despite refusal: ${stale.join(", ")}` };
    }
  }
  return { ok: true, reason: "refused gracefully and wrote no plan" };
}

function assertPlanWritten(result, dir) {
  const text = typeof result.result === "string" ? result.result : "";
  if (containsRefusal(text)) {
    return { ok: false, reason: "unexpected no-source refusal despite staged .tex" };
  }
  const planDir = resolve(dir, ".obelus");
  if (!existsSync(planDir)) {
    return { ok: false, reason: ".obelus/ directory not created" };
  }
  const entries = readdirSync(planDir);
  const mdPlan = entries.find((e) => e.startsWith("plan-") && e.endsWith(".md"));
  const jsonPlan = entries.find((e) => e.startsWith("plan-") && e.endsWith(".json"));
  if (!mdPlan) return { ok: false, reason: "no plan-*.md written" };
  if (!jsonPlan) return { ok: false, reason: "no plan-*.json companion written" };
  const body = readFileSync(resolve(planDir, mdPlan), "utf8");
  if (body.length < 200) {
    return { ok: false, reason: `plan markdown suspiciously short (${body.length} bytes)` };
  }
  return { ok: true, reason: `plan written: ${mdPlan}` };
}

function loadPlanJson(dir) {
  const planDir = resolve(dir, ".obelus");
  if (!existsSync(planDir)) return { error: ".obelus/ directory not created" };
  const entries = readdirSync(planDir);
  const jsonPlan = entries.find((e) => e.startsWith("plan-") && e.endsWith(".json"));
  if (!jsonPlan) return { error: "no plan-*.json companion written" };
  let plan;
  try {
    plan = JSON.parse(readFileSync(resolve(planDir, jsonPlan), "utf8"));
  } catch (e) {
    return { error: `plan-*.json not valid JSON (${e.message.slice(0, 80)})` };
  }
  if (!Array.isArray(plan.blocks)) {
    return { error: "plan-*.json has no blocks array" };
  }
  return { plan, jsonPlan };
}

function classifyBlock(block) {
  const id = typeof block.annotationId === "string" ? block.annotationId : "";
  if (id.startsWith("cascade-")) return "cascade";
  if (id.startsWith("impact-")) return "impact";
  if (id.startsWith("coherence-")) return "coherence";
  if (id.startsWith("quality-")) return "quality";
  return "source";
}

function guardRefusal(result) {
  const text = typeof result.result === "string" ? result.result : "";
  if (containsRefusal(text)) {
    return { ok: false, reason: "unexpected no-source refusal despite staged .tex" };
  }
  return null;
}

function assertLexicalTerminologyCascade(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const cascades = plan.blocks.filter((b) => classifyBlock(b) === "cascade");
  if (cascades.length < 1) {
    return { ok: false, reason: `expected ≥1 cascade-* block (line 14 'In such settings'), got 0` };
  }
  for (const c of cascades) {
    if (typeof c.patch !== "string" || c.patch.length === 0) {
      return { ok: false, reason: `cascade block ${c.annotationId} has empty patch` };
    }
    if (!c.patch.endsWith("\n")) {
      return { ok: false, reason: `cascade block ${c.annotationId} patch does not end with \\n` };
    }
    if (/experimental\s+setting/i.test(c.patch)) {
      return {
        ok: false,
        reason: `cascade block ${c.annotationId} wrongly cascaded into an 'experimental setting' line (different referent)`,
      };
    }
    if (typeof c.reviewerNotes !== "string" || !c.reviewerNotes.startsWith("Cascaded from ")) {
      return {
        ok: false,
        reason: `cascade block ${c.annotationId} reviewerNotes must start with 'Cascaded from '`,
      };
    }
  }
  return {
    ok: true,
    reason: `${cascades.length} cascade-* block(s) emitted; 'experimental settings' line correctly skipped`,
  };
}

function assertLexicalNumericalCascade(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const cascades = plan.blocks.filter((b) => classifyBlock(b) === "cascade");
  if (cascades.length < 1) {
    return { ok: false, reason: `expected ≥1 cascade-* block swapping 4.2B → 4.1B, got 0` };
  }
  for (const c of cascades) {
    if (!/^-.*4\.2B/m.test(c.patch)) {
      return {
        ok: false,
        reason: `cascade block ${c.annotationId} patch does not remove '4.2B' (numerical gate failed)`,
      };
    }
  }
  return { ok: true, reason: `${cascades.length} numerical cascade block(s) emitted` };
}

function assertStructuralLabelCascade(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const cascades = plan.blocks.filter((b) => classifyBlock(b) === "cascade");
  if (cascades.length < 1) {
    return {
      ok: false,
      reason: `expected ≥1 cascade-* block rewriting \\ref{thm-main}, got 0`,
    };
  }
  for (const c of cascades) {
    if (!/\\ref\{thm-main\}/.test(c.patch)) {
      return {
        ok: false,
        reason: `cascade block ${c.annotationId} patch does not reference \\ref{thm-main} on minus side`,
      };
    }
  }
  return { ok: true, reason: `${cascades.length} label-reference cascade block(s) emitted` };
}

function assertPropositionalImpact(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const cascades = plan.blocks.filter((b) => classifyBlock(b) === "cascade");
  const impacts = plan.blocks.filter((b) => classifyBlock(b) === "impact");

  if (cascades.length > 0) {
    const ids = cascades.map((c) => c.annotationId).join(", ");
    return {
      ok: false,
      reason: `propositional delta must not cascade (silent rewrite), got ${cascades.length}: ${ids}`,
    };
  }
  if (impacts.length < 1) {
    return {
      ok: false,
      reason: `expected ≥1 impact-* flag-note flagging sections that depend on the withdrawn i.i.d. assumption, got 0`,
    };
  }
  for (const im of impacts) {
    if (im.patch !== "") {
      return {
        ok: false,
        reason: `impact block ${im.annotationId} must carry patch: "", got ${JSON.stringify(im.patch).slice(0, 40)}`,
      };
    }
    if (im.category !== "unclear") {
      return {
        ok: false,
        reason: `impact block ${im.annotationId} must carry category: "unclear", got ${JSON.stringify(im.category)}`,
      };
    }
    if (typeof im.reviewerNotes !== "string" || !im.reviewerNotes.startsWith("Impact of ")) {
      return {
        ok: false,
        reason: `impact block ${im.annotationId} reviewerNotes must start with 'Impact of '`,
      };
    }
  }
  return { ok: true, reason: `${impacts.length} impact-* flag-note(s) emitted; zero cascades` };
}

function assertVacuousPhase(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const synthesised = plan.blocks.filter((b) => {
    const kind = classifyBlock(b);
    return kind === "cascade" || kind === "impact";
  });
  if (synthesised.length > 0) {
    const ids = synthesised.map((b) => b.annotationId).join(", ");
    return {
      ok: false,
      reason: `praise-only bundle should emit zero cascade/impact blocks, got ${synthesised.length}: ${ids}`,
    };
  }
  return { ok: true, reason: "praise-only bundle: zero cascade/impact blocks as expected" };
}

function assertCitationOnlyNoTrigger(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const synthesised = plan.blocks.filter((b) => {
    const kind = classifyBlock(b);
    return kind === "cascade" || kind === "impact";
  });
  if (synthesised.length > 0) {
    const ids = synthesised.map((b) => b.annotationId).join(", ");
    return {
      ok: false,
      reason: `citation-needed (pure addition, no token substituted) must not cascade; got ${synthesised.length}: ${ids}`,
    };
  }
  const source = plan.blocks.find((b) => classifyBlock(b) === "source");
  if (!source) {
    return { ok: false, reason: "citation-needed source block missing from plan" };
  }
  return { ok: true, reason: "citation-needed edit produced no cascade/impact (pure addition)" };
}

function assertDriftVsCascade(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const sources = plan.blocks.filter((b) => classifyBlock(b) === "source");
  const cascades = plan.blocks.filter((b) => classifyBlock(b) === "cascade");
  const coherences = plan.blocks.filter((b) => classifyBlock(b) === "coherence");

  if (sources.length < 2) {
    return {
      ok: false,
      reason: `expected ≥2 source edit blocks (two user marks), got ${sources.length}`,
    };
  }
  if (cascades.length < 1) {
    return { ok: false, reason: `expected ≥1 cascade-* block, got 0` };
  }
  if (coherences.length < 1) {
    return {
      ok: false,
      reason: `expected ≥1 coherence-* block flagging drift between 'contexts' and 'scenarios' renames, got 0`,
    };
  }
  return {
    ok: true,
    reason: `${sources.length} source + ${cascades.length} cascade + ${coherences.length} coherence block(s); drift flagged`,
  };
}

function assertLexicalMorphologyCascade(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const cascades = plan.blocks.filter((b) => classifyBlock(b) === "cascade");
  if (cascades.length < 1) {
    return {
      ok: false,
      reason: `expected ≥1 cascade-* block covering morphological variants of 'failure', got 0`,
    };
  }

  // The note explicitly names a paper-wide rename of failure → pattern and calls out
  // morphological variants. Cascades must collectively cover at least two variants from
  // the surface set {failure, failures, failure modes, failure mode}, excluding the
  // originating span ('three failure modes', line 13).
  const variantPatterns = [
    { label: "'failures' (plural)", re: /^-\s.*\bfailures\b/m },
    { label: "'failure mode' (singular compound)", re: /^-\s.*\bfailure\s+mode\b(?!s)/m },
    { label: "bare 'failure' (singular)", re: /^-\s.*\bfailure\b(?!\s*mode)(?!s)/m },
  ];
  const covered = new Set();
  for (const c of cascades) {
    if (typeof c.patch !== "string" || c.patch.length === 0) {
      return { ok: false, reason: `cascade block ${c.annotationId} has empty patch` };
    }
    if (!c.patch.endsWith("\n")) {
      return { ok: false, reason: `cascade block ${c.annotationId} patch does not end with \\n` };
    }
    if (typeof c.reviewerNotes !== "string" || !c.reviewerNotes.startsWith("Cascaded from ")) {
      return {
        ok: false,
        reason: `cascade block ${c.annotationId} reviewerNotes must start with 'Cascaded from '`,
      };
    }
    // Must not cascade into 'test failure' / 'test failure mode' in Methods — different referent.
    if (/\btest\s+failure/i.test(c.patch)) {
      return {
        ok: false,
        reason: `cascade block ${c.annotationId} wrongly cascaded into a 'test failure' line (different referent in Methods)`,
      };
    }
    for (const v of variantPatterns) {
      if (v.re.test(c.patch)) covered.add(v.label);
    }
  }
  if (covered.size < 2) {
    const got = covered.size === 0 ? "(none)" : Array.from(covered).join(", ");
    return {
      ok: false,
      reason: `expected cascades to cover ≥2 morphological variants (of failures/failure mode/failure); covered: ${got}`,
    };
  }
  return {
    ok: true,
    reason: `${cascades.length} cascade-* block(s) covering ${covered.size} morphological variant(s): ${Array.from(covered).join(", ")}; 'test failure' referent correctly skipped`,
  };
}

function hunkLineRange(patch) {
  const m = typeof patch === "string" ? patch.match(/^@@ -(\d+),(\d+) \+\d+,\d+ @@/m) : null;
  if (!m) return null;
  return { start: Number(m[1]), len: Number(m[2]) };
}

function assertQualitySweep(result, dir) {
  const refusal = guardRefusal(result);
  if (refusal) return refusal;
  const { plan, error } = loadPlanJson(dir);
  if (error) return { ok: false, reason: error };

  const quality = plan.blocks.filter((b) => classifyBlock(b) === "quality");
  if (quality.length < 1) {
    return {
      ok: false,
      reason: `expected ≥1 quality-* block from the rubric-driven holistic pass, got 0 (planted boilerplate / citation-gap should have been surfaced)`,
    };
  }
  for (const q of quality) {
    if (typeof q.patch !== "string" || q.patch.length === 0) {
      return { ok: false, reason: `quality block ${q.annotationId} has empty patch` };
    }
    if (!q.patch.endsWith("\n")) {
      return { ok: false, reason: `quality block ${q.annotationId} patch does not end with \\n` };
    }
    if (typeof q.reviewerNotes !== "string" || !q.reviewerNotes.startsWith("Quality pass: ")) {
      return {
        ok: false,
        reason: `quality block ${q.annotationId} reviewerNotes must start with 'Quality pass: '`,
      };
    }
    if (q.ambiguous !== false) {
      return {
        ok: false,
        reason: `quality block ${q.annotationId} must carry ambiguous: false, got ${JSON.stringify(q.ambiguous)}`,
      };
    }
  }

  // Quality pass must not collide with the user mark's line range.
  const sources = plan.blocks.filter((b) => classifyBlock(b) === "source");
  const sourceLines = new Set();
  for (const s of sources) {
    const range = hunkLineRange(s.patch);
    if (!range) continue;
    for (let i = range.start; i < range.start + range.len; i += 1) sourceLines.add(i);
  }
  for (const q of quality) {
    const range = hunkLineRange(q.patch);
    if (!range) continue;
    for (let i = range.start; i < range.start + range.len; i += 1) {
      if (sourceLines.has(i)) {
        return {
          ok: false,
          reason: `quality block ${q.annotationId} collides with a user-mark line range at line ${i}`,
        };
      }
    }
  }
  return {
    ok: true,
    reason: `${quality.length} quality-* block(s) emitted; no user-mark collisions`,
  };
}

function resolveAuthMode() {
  const override = process.env.OBELUS_E2E_AUTH;
  if (override === "api-key" || override === "subscription") return override;
  if (override) {
    console.error(
      `[plugin:e2e] OBELUS_E2E_AUTH=${override} not recognized (expected "api-key" or "subscription").`,
    );
    process.exit(2);
  }
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_USE_BEDROCK ||
    process.env.CLAUDE_CODE_USE_VERTEX
  ) {
    return "api-key";
  }
  return "subscription";
}

function preflight() {
  const probe = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.error("[plugin:e2e] claude CLI not found on PATH.");
    console.error("  Install: npm i -g @anthropic-ai/claude-code");
    process.exit(2);
  }
  const mode = resolveAuthMode();
  if (mode === "api-key") {
    console.log(
      "[plugin:e2e] auth: api-key (--bare; reads ANTHROPIC_API_KEY / Bedrock / Vertex env)",
    );
  } else {
    console.log(
      "[plugin:e2e] auth: subscription (reads OAuth/keychain — run `claude /login` once if unset)",
    );
  }
  return mode;
}

function buildArgs(prompt, mode) {
  const args = ["-p"];
  if (mode === "api-key") args.push("--bare");
  args.push(
    "--plugin-dir",
    pluginDir,
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "json",
    "--max-budget-usd",
    BUDGET_USD,
    prompt,
  );
  return args;
}

function runScenario(s, mode) {
  const dir = resolve(tmpRoot, s.name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  s.stage(dir);

  const started = Date.now();
  const cp = spawnSync("claude", buildArgs(s.prompt, mode), {
    cwd: dir,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  const durationMs = Date.now() - started;

  if (cp.error) {
    return { ...meta(s), ok: false, reason: `spawn error: ${cp.error.message}`, durationMs };
  }
  if (cp.status !== 0) {
    const tail = (cp.stderr || cp.stdout || "").slice(-240).trim().replace(/\s+/g, " ");
    return { ...meta(s), ok: false, reason: `claude exited ${cp.status}: ${tail}`, durationMs };
  }

  let parsed;
  try {
    parsed = JSON.parse(cp.stdout);
  } catch (e) {
    return {
      ...meta(s),
      ok: false,
      reason: `stdout not valid JSON (${e.message.slice(0, 80)})`,
      durationMs,
    };
  }

  const output = typeof parsed.result === "string" ? parsed.result : "";

  if (parsed.is_error) {
    const r = output ? output.slice(0, 200) : "(no result text)";
    return { ...meta(s), ok: false, reason: `claude reported is_error: ${r}`, durationMs, output };
  }

  const { ok, reason } = s.assert(parsed, dir);
  return { ...meta(s), ok, reason, durationMs, output };
}

function meta(s) {
  return { id: s.id, name: s.name };
}

function printSummary(results) {
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const bar = "─".repeat(78);
  console.log("");
  console.log("[plugin:e2e] Summary");
  console.log(bar);
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    const id = r.id.padEnd(4);
    const name = r.name.padEnd(22);
    const dur = `${String(Math.round(r.durationMs / 1000)).padStart(3)}s`;
    console.log(`${mark} ${id} ${name} ${dur}  ${r.reason}`);
    if (r.output) {
      console.log("");
      for (const line of r.output.split("\n")) console.log(`    ${line}`);
      console.log("");
    }
  }
  console.log(bar);
  console.log(`${passed}/${total} scenarios passed`);
}

function main() {
  const mode = preflight();

  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });

  const selected =
    ONLY_IDS.length > 0 ? scenarios.filter((s) => ONLY_IDS.includes(s.id)) : scenarios;
  if (ONLY_IDS.length > 0) {
    const missing = ONLY_IDS.filter((id) => !scenarios.some((s) => s.id === id));
    if (missing.length > 0) {
      console.error(`[plugin:e2e] unknown scenario id(s): ${missing.join(", ")}`);
      process.exit(2);
    }
    console.log(
      `[plugin:e2e] OBELUS_E2E_ONLY=${ONLY_IDS.join(",")} — running ${selected.length}/${scenarios.length}`,
    );
  }

  const results = [];
  for (const s of selected) {
    console.log(`[plugin:e2e] ${s.id} ${s.name} — ${s.prompt}`);
    results.push(runScenario(s, mode));
  }

  printSummary(results);

  const allOk = results.every((r) => r.ok);
  if (allOk) {
    rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(0);
  }
  console.log("");
  console.log(`[plugin:e2e] preserved temp dirs for inspection: ${tmpRoot}`);
  process.exit(1);
}

main();
