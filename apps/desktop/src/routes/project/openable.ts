export const SOURCE_EXTS: ReadonlySet<string> = new Set([
  "tex",
  "md",
  "typ",
  "bib",
  "txt",
  "html",
  "json",
  "jsonl",
  "ndjson",
  "yaml",
  "yml",
  "toml",
  "csv",
  "tsv",
  "xml",
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "sh",
]);

export const OPENABLE_EXTS: ReadonlySet<string> = new Set([...SOURCE_EXTS, "pdf"]);

// Directory names pruned from the tree unconditionally. These are never
// review-relevant and each can contribute tens of thousands of files.
export const NOISE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  ".git",
  ".obelus",
  ".venv",
  ".next",
  ".turbo",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
]);

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function isOpenable(name: string): boolean {
  return OPENABLE_EXTS.has(extensionOf(name));
}

export function isSource(name: string): boolean {
  return SOURCE_EXTS.has(extensionOf(name));
}
