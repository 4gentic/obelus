import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BundleV1 } from "../dist/schema.js";
import { BundleV2 } from "../dist/schema-v2.js";

const here = dirname(fileURLToPath(import.meta.url));

const targets = [
  { schema: BundleV1, name: "ObelusBundleV1", file: "bundle-v1.schema.json" },
  { schema: BundleV2, name: "ObelusBundleV2", file: "bundle-v2.schema.json" },
];

for (const { schema, name, file } of targets) {
  const out = resolve(here, "../dist", file);
  const jsonSchema = zodToJsonSchema(schema, { name, $refStrategy: "none" });
  writeFileSync(out, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
}
