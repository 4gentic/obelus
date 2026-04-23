#!/usr/bin/env node
// Renders <!-- @prompts:NAME --> ... <!-- /@prompts:NAME --> regions in the
// claude-plugin Markdown files using fragment text imported from the built
// `@obelus/prompts` package. Run after `pnpm -F @obelus/prompts build`.
//
// Pass `--check` to fail when any file would be rewritten — used by
// `pnpm prompts:check` so a stale fragment region in a SKILL.md fails CI
// without requiring a clean working tree elsewhere.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checkOnly = process.argv.includes("--check");

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const promptsDist = resolve(repoRoot, "packages/prompts/dist/index.js");
const pluginRoots = [
  resolve(repoRoot, "packages/claude-plugin"),
  resolve(repoRoot, "packages/claude-plugin-drafter"),
];

const fragments = await import(promptsDist);

const FRAGMENT_TABLE = {
  "category-map": fragments.CATEGORY_MAP_MARKDOWN,
  "edit-shape": fragments.EDIT_SHAPE_MARKDOWN,
  voice: fragments.VOICE_MARKDOWN,
  refusals: fragments.REVIEW_REFUSALS_MARKDOWN,
};

function listMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listMarkdown(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function renderFile(path) {
  const original = readFileSync(path, "utf8");
  const rendered = original.replaceAll(
    /<!-- @prompts:([a-z0-9-]+) -->[\s\S]*?<!-- \/@prompts:\1 -->/g,
    (_match, name) => {
      const body = FRAGMENT_TABLE[name];
      if (body === undefined) {
        throw new Error(`unknown prompt fragment '${name}' referenced in ${path}`);
      }
      return `<!-- @prompts:${name} -->\n${body}\n<!-- /@prompts:${name} -->`;
    },
  );
  if (rendered === original) return false;
  if (!checkOnly) writeFileSync(path, rendered);
  return true;
}

const targets = pluginRoots.flatMap((root) => {
  const dirs = ["skills", "agents", "commands"];
  const out = [];
  for (const sub of dirs) {
    try {
      out.push(...listMarkdown(join(root, sub)));
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
  }
  return out;
});

let touched = 0;
for (const target of targets) {
  if (renderFile(target)) {
    touched += 1;
    if (checkOnly) {
      console.error(`[render-prompt-fragments] stale fragment region: ${target}`);
    } else {
      console.info(`[render-prompt-fragments] wrote ${target}`);
    }
  }
}
const verb = checkOnly ? "would rewrite" : "rewrote";
console.info(`[render-prompt-fragments] scanned ${targets.length} files, ${verb} ${touched}`);
if (checkOnly && touched > 0) {
  console.error(
    "[render-prompt-fragments] one or more SKILL.md fragment regions are out of sync with " +
      "@obelus/prompts. Run `pnpm prompts:render` and commit the result.",
  );
  process.exit(1);
}
