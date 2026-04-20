import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONSchema } from "zod";
import { BundleV1 } from "../dist/schema.js";
import { BundleV2 } from "../dist/schema-v2.js";

// Emits canonical JSON Schema artifacts into packages/bundle-schema/schemas/.
// Committed to git (unlike dist/) so the plugin's bundle-validation skill can
// resolve the schema from any fresh clone without a build step.
// Uses Zod 4's built-in toJSONSchema; zod-to-json-schema is a Zod 3 tool and
// returns empty shapes against Zod 4 internals.

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../schemas");
mkdirSync(outDir, { recursive: true });

const targets = [
  { schema: BundleV1, file: "bundle-v1.schema.json" },
  { schema: BundleV2, file: "bundle-v2.schema.json" },
];

for (const { schema, file } of targets) {
  const jsonSchema = toJSONSchema(schema);
  const out = resolve(outDir, file);
  writeFileSync(out, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
}
