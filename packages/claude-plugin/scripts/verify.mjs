import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBundle } from "@obelus/bundle-schema";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = ["fixtures/sample/bundle.json", "fixtures/sample/bundle-v2.json"];

let ok = true;
for (const rel of fixtures) {
  const path = resolve(here, "..", rel);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const result = parseBundle(raw);
  if (!result.ok) {
    console.error(`[verify] ${rel}: ${result.error}`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
