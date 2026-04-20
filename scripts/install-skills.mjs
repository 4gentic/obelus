#!/usr/bin/env node
// Install a curated set of Claude Code skills into .claude/skills/.
// Edit the SKILLS manifest to add or remove skills; re-run to update in place.
// Set GITHUB_TOKEN to raise the unauthenticated API rate limit.
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "..", ".claude", "skills");

const AITMPL = "davila7/claude-code-templates";
const AITMPL_DEV = "cli-tool/components/skills/development";

const SKILLS = [
  // direct stack match
  { repo: AITMPL, path: `${AITMPL_DEV}/typescript-pro`, name: "typescript-pro" },
  { repo: AITMPL, path: `${AITMPL_DEV}/react-best-practices`, name: "react-best-practices" },
  { repo: AITMPL, path: `${AITMPL_DEV}/react-useeffect`, name: "react-useeffect" },
  { repo: AITMPL, path: `${AITMPL_DEV}/rust-pro`, name: "rust-pro" },
  { repo: AITMPL, path: `${AITMPL_DEV}/monorepo-architect`, name: "monorepo-architect" },
  { repo: AITMPL, path: `${AITMPL_DEV}/playwright`, name: "playwright" },
  { repo: AITMPL, path: `${AITMPL_DEV}/accessibility`, name: "accessibility" },
  { repo: AITMPL, path: `${AITMPL_DEV}/core-web-vitals`, name: "core-web-vitals" },
  // workflow multipliers
  { repo: AITMPL, path: `${AITMPL_DEV}/systematic-debugging`, name: "systematic-debugging" },
  {
    repo: AITMPL,
    path: `${AITMPL_DEV}/architecture-decision-records`,
    name: "architecture-decision-records",
  },
  { repo: AITMPL, path: `${AITMPL_DEV}/using-git-worktrees`, name: "using-git-worktrees" },
  { repo: AITMPL, path: `${AITMPL_DEV}/dependency-updater`, name: "dependency-updater" },
  { repo: AITMPL, path: `${AITMPL_DEV}/github-actions-creator`, name: "github-actions-creator" },
  { repo: AITMPL, path: `${AITMPL_DEV}/gh-fix-ci`, name: "gh-fix-ci" },
  { repo: AITMPL, path: `${AITMPL_DEV}/lint-and-validate`, name: "lint-and-validate" },
  // meta / authoring
  { repo: AITMPL, path: `${AITMPL_DEV}/skill-creator`, name: "skill-creator" },
  { repo: AITMPL, path: `${AITMPL_DEV}/writing-skills`, name: "writing-skills" },
  { repo: AITMPL, path: `${AITMPL_DEV}/writing-plans`, name: "writing-plans" },
  { repo: AITMPL, path: `${AITMPL_DEV}/executing-plans`, name: "executing-plans" },
  // community additions
  {
    repo: "asyrafhussin/agent-skills",
    path: "skills/react-vite-best-practices",
    name: "react-vite-best-practices",
  },
  { repo: "ibelick/ui-skills", path: "skills/fixing-accessibility", name: "fixing-accessibility" },
];

const apiHeaders = {
  "User-Agent": "obelus-install-skills",
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function api(url) {
  const res = await fetch(url, { headers: apiHeaders });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

async function walk(repo, path, prefix = "") {
  const entries = await api(`https://api.github.com/repos/${repo}/contents/${path}`);
  const files = [];
  for (const entry of entries) {
    if (entry.type === "file") {
      files.push({ rel: prefix + entry.name, url: entry.download_url });
    } else if (entry.type === "dir") {
      const nested = await walk(repo, entry.path, `${prefix}${entry.name}/`);
      files.push(...nested);
    }
  }
  return files;
}

async function install(skill) {
  const files = await walk(skill.repo, skill.path);
  if (files.length === 0) throw new Error("no files found at source path");
  const dir = join(TARGET, skill.name);
  for (const f of files) {
    const full = join(dir, f.rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, await fetchText(f.url));
  }
  return files.length;
}

async function alreadyInstalled(name) {
  try {
    await access(join(TARGET, name, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}

const force = process.argv.includes("--force");

const _t0 = Date.now();
let _ok = 0;
let _skipped = 0;
let failed = 0;
for (const skill of SKILLS) {
  if (!force && (await alreadyInstalled(skill.name))) {
    _skipped++;
    continue;
  }
  try {
    const _n = await install(skill);
    _ok++;
  } catch (err) {
    console.error(`  err ${skill.name}  — ${err.message}`);
    failed++;
  }
}
if (failed > 0) process.exit(1);
