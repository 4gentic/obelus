#!/usr/bin/env node
// Install Obelus skills + the OpenCode paper-reviewer agent into the cwd.
// Run from your paper repo root:
//   npx -y github:4gentic/obelus#main obelus-install-opencode
// Resources are copied from the locally-fetched obelus checkout — no extra
// network calls beyond npx pulling the repo.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PLUGIN_ROOT = join(REPO_ROOT, "packages", "claude-plugin");
const SOURCE_SKILLS = join(PLUGIN_ROOT, "skills");
const SOURCE_AGENT = join(PLUGIN_ROOT, "agents", "paper-reviewer.opencode.md");

const TARGET = resolve(process.cwd());
const TARGET_SKILLS = join(TARGET, ".claude", "skills");
const TARGET_AGENT = join(TARGET, ".opencode", "agents", "paper-reviewer.md");

const AGENT_SENTINEL = "stress-tests proposed paper edits";

function abort(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (TARGET === REPO_ROOT) {
  abort(
    "refusing to install into the obelus repo itself; run this from your paper repo, not the obelus checkout",
  );
}

if (!existsSync(SOURCE_SKILLS) || !existsSync(SOURCE_AGENT)) {
  abort(
    `installer source missing — expected ${SOURCE_SKILLS} and ${SOURCE_AGENT}. Did you run this outside an obelus checkout?`,
  );
}

if (existsSync(TARGET_AGENT)) {
  const existing = await readFile(TARGET_AGENT, "utf8");
  if (!existing.includes(AGENT_SENTINEL)) {
    abort(
      `refusing to overwrite ${relative(TARGET, TARGET_AGENT)}: it doesn't look like an Obelus agent. Move it aside and re-run.`,
    );
  }
}

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  let count = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      count += await copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
      count += 1;
    }
  }
  return count;
}

const skillsCopied = await copyTree(SOURCE_SKILLS, TARGET_SKILLS);
await mkdir(dirname(TARGET_AGENT), { recursive: true });
await copyFile(SOURCE_AGENT, TARGET_AGENT);

const skillNames = (await readdir(TARGET_SKILLS, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

console.info("[install-obelus-opencode]", {
  skillsCopied,
  skills: skillNames,
  agentWritten: relative(TARGET, TARGET_AGENT),
  target: TARGET,
});

const indent = `  ${sep === "\\" ? "" : ""}`;
console.log(`Installed ${skillsCopied} files across ${skillNames.length} skills.`);
console.log(`${indent}skills → ${relative(TARGET, TARGET_SKILLS) || "."}`);
console.log(`${indent}agent  → ${relative(TARGET, TARGET_AGENT)}`);
console.log("");
console.log("Next: opencode auth login (once), then run from this directory.");
