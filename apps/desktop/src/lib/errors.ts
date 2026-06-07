// Tauri's `invoke` rejects with whatever the Rust command's error serialized
// to. `AppError` serializes via `serialize_str`, so the rejection is a bare
// string — `err instanceof Error` is false and naive `err.message` access
// silently drops the real diagnostic. Recover the message from any shape, only
// falling back to the generic label when there is genuinely nothing to show.
export function errorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof err.message === "string" &&
    err.message
  ) {
    return err.message;
  }
  return fallback;
}
