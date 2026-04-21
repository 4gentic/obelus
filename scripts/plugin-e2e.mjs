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
// Default out-of-repo: otherwise, subscription mode (no --bare) auto-discovers
// the repo's CLAUDE.md by walking up from the scenario cwd.
const tmpRoot = process.env.OBELUS_E2E_TMP_DIR
  ? resolve(process.env.OBELUS_E2E_TMP_DIR)
  : resolve(tmpdir(), "obelus-plugin-e2e");

const BUDGET_USD = "1.00";
const TIMEOUT_MS = 180_000;
const MAX_BUFFER = 16 * 1024 * 1024;

const REFUSAL_PREFIX = "I can't apply this revision";
const WRITE_REVIEW_FALLBACK = "/obelus:write-review";

const scenarios = [
  {
    id: "1.1",
    name: "review-single",
    prompt: "/obelus:write-review ./bundle.json",
    stage(dir) {
      cpSync(resolve(fixturesDir, "bundle.json"), resolve(dir, "bundle.json"));
    },
    assert: assertReviewLetter,
  },
  {
    id: "1.2",
    name: "review-with-sources",
    prompt: "/obelus:write-review ./bundle.json",
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
];

function assertReviewLetter(result, _dir) {
  const text = typeof result.result === "string" ? result.result : "";
  if (!text.includes("# Review")) {
    return { ok: false, reason: "stdout missing `# Review` heading" };
  }
  if (!text.includes("On the Scalability of Transformer Attention")) {
    return { ok: false, reason: "stdout missing paper title" };
  }
  if (text.includes(REFUSAL_PREFIX)) {
    return { ok: false, reason: "apply-revision refusal appeared in write-review output" };
  }
  const tracedCitation = /vaswani/i.test(text);
  const tracedClaim = /production systems/i.test(text);
  if (!tracedCitation && !tracedClaim) {
    return { ok: false, reason: "letter surfaced neither citation nor unclear-claim annotation" };
  }
  return { ok: true, reason: "letter well-formed with annotation traces" };
}

function assertNoSourceRefusal(result, dir) {
  const text = typeof result.result === "string" ? result.result : "";
  if (!text.includes(REFUSAL_PREFIX)) {
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
  if (text.includes(REFUSAL_PREFIX)) {
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

  const results = [];
  for (const s of scenarios) {
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
