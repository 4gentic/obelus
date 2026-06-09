import { formatError } from "./format-error.js";
import {
  MARKS_ARCHIVE_VERSION,
  type MarksArchive,
  MarksArchive as MarksArchiveSchema,
} from "./marks-archive.js";

export type MarksArchiveParseResult =
  | { ok: true; version: typeof MARKS_ARCHIVE_VERSION; archive: MarksArchive }
  | { ok: false; error: string };

export function parseMarksArchive(input: unknown): MarksArchiveParseResult {
  if (typeof input !== "object" || input === null || !("marksArchiveVersion" in input)) {
    return { ok: false, error: "(root): missing marksArchiveVersion" };
  }
  const version = (input as { marksArchiveVersion: unknown }).marksArchiveVersion;

  if (version !== MARKS_ARCHIVE_VERSION) {
    return {
      ok: false,
      error: `(root).marksArchiveVersion: unsupported "${String(version)}"`,
    };
  }

  const result = MarksArchiveSchema.safeParse(input);
  if (result.success) return { ok: true, version: MARKS_ARCHIVE_VERSION, archive: result.data };
  return formatError(result.error);
}
