import type { z } from "zod";

// Reduces a ZodError to a single readable "path: message" line — the first
// issue is the one a human acts on. Shared by every boundary parser so the
// failure shape is identical across bundles and marks archives.
export function formatError(error: z.ZodError): { ok: false; error: string } {
  const first = error.issues[0];
  const path = first ? first.path.join(".") : "(root)";
  const message = first ? first.message : "unknown error";
  return { ok: false, error: `${path}: ${message}` };
}
