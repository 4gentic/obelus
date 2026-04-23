import type { ReviewSessionCreateInput, ReviewSessionsRepo } from "../interface";
import type { AppliedSnapshot, ReviewSessionRow, ReviewSessionStatus } from "../types";
import type { Database } from "./db";

interface ReviewSessionSqlRow {
  id: string;
  project_id: string;
  paper_id: string;
  bundle_id: string;
  model: string | null;
  effort: string | null;
  started_at: string;
  completed_at: string | null;
  applied_at: string | null;
  status: string;
  last_error: string | null;
  apply_status_json: string | null;
  claude_session_id: string | null;
}

const STATUSES: ReadonlySet<ReviewSessionStatus> = new Set([
  "running",
  "ingesting",
  "completed",
  "failed",
  "discarded",
]);

function parseStatus(raw: string): ReviewSessionStatus {
  return (STATUSES as Set<string>).has(raw) ? (raw as ReviewSessionStatus) : "completed";
}

function parseAppliedSnapshot(raw: string | null): AppliedSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { filesWritten?: unknown }).filesWritten === "number" &&
      typeof (parsed as { hunksApplied?: unknown }).hunksApplied === "number"
    ) {
      const obj = parsed as { filesWritten: number; hunksApplied: number; draftOrdinal?: number };
      return obj.draftOrdinal === undefined
        ? { filesWritten: obj.filesWritten, hunksApplied: obj.hunksApplied }
        : {
            filesWritten: obj.filesWritten,
            hunksApplied: obj.hunksApplied,
            draftOrdinal: obj.draftOrdinal,
          };
    }
  } catch {
    // Falls through to null — snapshots are advisory; the diff_hunks table
    // is the source of truth for what was applied.
  }
  return null;
}

function toRow(r: ReviewSessionSqlRow): ReviewSessionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    paperId: r.paper_id,
    bundleId: r.bundle_id,
    model: r.model,
    effort: r.effort,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    appliedAt: r.applied_at,
    status: parseStatus(r.status),
    lastError: r.last_error,
    appliedSnapshot: parseAppliedSnapshot(r.apply_status_json),
    claudeSessionId: r.claude_session_id,
  };
}

const SELECT =
  "SELECT id, project_id, paper_id, bundle_id, model, effort, started_at, completed_at, applied_at, status, last_error, apply_status_json, claude_session_id FROM review_sessions";

export function buildReviewSessionsRepo(db: Database): ReviewSessionsRepo {
  return {
    async listForPaper(paperId: string): Promise<ReviewSessionRow[]> {
      const rows = await db.select<ReviewSessionSqlRow[]>(
        `${SELECT} WHERE paper_id = $1 ORDER BY started_at DESC`,
        [paperId],
      );
      return rows.map(toRow);
    },

    async get(id: string): Promise<ReviewSessionRow | undefined> {
      const rows = await db.select<ReviewSessionSqlRow[]>(`${SELECT} WHERE id = $1`, [id]);
      const row = rows[0];
      return row ? toRow(row) : undefined;
    },

    async latestForPaper(paperId: string): Promise<ReviewSessionRow | undefined> {
      const rows = await db.select<ReviewSessionSqlRow[]>(
        `${SELECT} WHERE paper_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [paperId],
      );
      const row = rows[0];
      return row ? toRow(row) : undefined;
    },

    async create(input: ReviewSessionCreateInput): Promise<ReviewSessionRow> {
      const id = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      await db.execute(
        `INSERT INTO review_sessions
           (id, project_id, paper_id, bundle_id, model, effort, started_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')`,
        [id, input.projectId, input.paperId, input.bundleId, input.model, input.effort, startedAt],
      );
      return {
        id,
        projectId: input.projectId,
        paperId: input.paperId,
        bundleId: input.bundleId,
        model: input.model,
        effort: input.effort,
        startedAt,
        completedAt: null,
        appliedAt: null,
        status: "running",
        lastError: null,
        appliedSnapshot: null,
        claudeSessionId: null,
      };
    },

    async complete(id: string): Promise<void> {
      await db.execute(
        "UPDATE review_sessions SET completed_at = $1, status = 'completed', last_error = NULL WHERE id = $2",
        [new Date().toISOString(), id],
      );
    },

    async markApplied(id: string): Promise<void> {
      await db.execute("UPDATE review_sessions SET applied_at = $1 WHERE id = $2", [
        new Date().toISOString(),
        id,
      ]);
    },

    async setStatus(
      id: string,
      status: ReviewSessionStatus,
      lastError?: string | null,
    ): Promise<void> {
      if (lastError === undefined) {
        await db.execute("UPDATE review_sessions SET status = $1 WHERE id = $2", [status, id]);
      } else {
        await db.execute("UPDATE review_sessions SET status = $1, last_error = $2 WHERE id = $3", [
          status,
          lastError,
          id,
        ]);
      }
    },

    async setClaudeSessionId(id: string, claudeSessionId: string | null): Promise<void> {
      await db.execute("UPDATE review_sessions SET claude_session_id = $1 WHERE id = $2", [
        claudeSessionId,
        id,
      ]);
    },

    async setAppliedSnapshot(id: string, snapshot: AppliedSnapshot | null): Promise<void> {
      const json = snapshot === null ? null : JSON.stringify(snapshot);
      await db.execute("UPDATE review_sessions SET apply_status_json = $1 WHERE id = $2", [
        json,
        id,
      ]);
    },
  };
}
