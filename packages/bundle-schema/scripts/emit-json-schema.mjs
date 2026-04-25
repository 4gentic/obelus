import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONSchema } from "zod";
import { CompileErrorBundle } from "../src/compile-error.ts";
import { ProjectMeta } from "../src/project-meta.ts";
import { Bundle } from "../src/schema.ts";

// Emits canonical JSON Schema artifacts to two locations:
// 1. packages/bundle-schema/schemas/ — the workspace export (consumed by
//    `@obelus/bundle-schema/json-schema/*` subpath imports in dev).
// 2. packages/claude-plugin/schemas/ — the plugin's shipped copy.
//    marketplace.json sets the plugin source to ./packages/claude-plugin,
//    so anything the plugin cache needs at install time must live under
//    that directory. The skills reference ${CLAUDE_PLUGIN_ROOT}/schemas/.
// Both copies are committed so a fresh clone or a remote plugin install
// works without a build step.
// Uses Zod 4's built-in toJSONSchema; zod-to-json-schema is a Zod 3 tool
// and returns empty shapes against Zod 4 internals.

const here = dirname(fileURLToPath(import.meta.url));
const outDirs =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => resolve(p))
    : [resolve(here, "../schemas"), resolve(here, "../../claude-plugin/schemas")];
for (const dir of outDirs) mkdirSync(dir, { recursive: true });

const targets = [
  { schema: Bundle, file: "bundle.schema.json" },
  { schema: ProjectMeta, file: "project-meta.schema.json" },
  { schema: CompileErrorBundle, file: "compile-error.schema.json" },
];

for (const { schema, file } of targets) {
  const jsonSchema = toJSONSchema(schema);
  const body = `${JSON.stringify(jsonSchema, null, 2)}\n`;
  for (const dir of outDirs) {
    writeFileSync(resolve(dir, file), body, "utf8");
  }
}
