import type { z } from "zod";
import { BundleV1 } from "./schema.js";
import { BundleV2 } from "./schema-v2.js";
import type { Bundle } from "./types.js";
import type { Bundle2 } from "./types-v2.js";

export type ParseResult =
  | { ok: true; version: "1.0"; bundle: Bundle }
  | { ok: true; version: "2.0"; bundle: Bundle2 }
  | { ok: false; error: string };

export function parseBundle(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || !("bundleVersion" in input)) {
    return { ok: false, error: "(root): missing bundleVersion" };
  }
  const version = (input as { bundleVersion: unknown }).bundleVersion;

  if (version === "1.0") {
    const result = BundleV1.safeParse(input);
    if (result.success) return { ok: true, version: "1.0", bundle: result.data };
    return formatError(result.error);
  }

  if (version === "2.0") {
    const result = BundleV2.safeParse(input);
    if (result.success) return { ok: true, version: "2.0", bundle: result.data };
    return formatError(result.error);
  }

  return {
    ok: false,
    error: `(root).bundleVersion: unsupported "${String(version)}"`,
  };
}

function formatError(error: z.ZodError): ParseResult {
  const first = error.issues[0];
  const path = first ? first.path.join(".") : "(root)";
  const message = first ? first.message : "unknown error";
  return { ok: false, error: `${path}: ${message}` };
}
