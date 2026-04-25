import type { z } from "zod";
import { type Bundle, Bundle as BundleSchema } from "./schema.js";

export type ParseResult =
  | { ok: true; version: typeof BUNDLE_VERSION_LITERAL; bundle: Bundle }
  | { ok: false; error: string };

const BUNDLE_VERSION_LITERAL = "1.0";

export function parseBundle(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || !("bundleVersion" in input)) {
    return { ok: false, error: "(root): missing bundleVersion" };
  }
  const version = (input as { bundleVersion: unknown }).bundleVersion;

  if (version !== BUNDLE_VERSION_LITERAL) {
    return {
      ok: false,
      error: `(root).bundleVersion: unsupported "${String(version)}"`,
    };
  }

  const result = BundleSchema.safeParse(input);
  if (result.success) return { ok: true, version: BUNDLE_VERSION_LITERAL, bundle: result.data };
  return formatError(result.error);
}

function formatError(error: z.ZodError): ParseResult {
  const first = error.issues[0];
  const path = first ? first.path.join(".") : "(root)";
  const message = first ? first.message : "unknown error";
  return { ok: false, error: `${path}: ${message}` };
}
