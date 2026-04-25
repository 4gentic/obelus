import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CompileErrorBundle, parseBundle } from "@obelus/bundle-schema";

const here = dirname(fileURLToPath(import.meta.url));
const reviewFixtures = ["fixtures/sample/bundle.json"];
const compileErrorFixtures = [
  "fixtures/compile-fix/typst-error.bundle.json",
  "fixtures/compile-fix/latex-error.bundle.json",
];

let ok = true;
for (const rel of reviewFixtures) {
  const path = resolve(here, "..", rel);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const result = parseBundle(raw);
  if (!result.ok) {
    console.error(`[verify] ${rel}: ${result.error}`);
    ok = false;
  }
}
for (const rel of compileErrorFixtures) {
  const path = resolve(here, "..", rel);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const result = CompileErrorBundle.safeParse(raw);
  if (!result.success) {
    console.error(`[verify] ${rel}: ${result.error.message}`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
