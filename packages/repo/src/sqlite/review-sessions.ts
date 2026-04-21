import type { ReviewSessionCreateInput, ReviewSessionsRepo } from "../interface";
import type { ReviewSessionRow } from "../types";
import type { Database } from "./db";

interface ReviewSessionSqlRow {
  id: string;
  project_id: string;
  bundle_id: string;
  claude_version: string | null;
  model: string | null;
  effort: string | null;
  started_at: string;
  completed_at: string | null;
  applied_at: string | null;
}

function toRow(r: ReviewSessionSqlRow): ReviewSessionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    bundleId: r.bundle_id,
    claudeVersion: r.claude_version,
    model: r.model,
    effort: r.effort,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    appliedAt: r.applied_at,
  };
}

const SELECT =
  "SELECT id, project_id, bundle_id, claude_version, model, effort, started_at, completed_at, applied_at FROM review_sessions";

export function buildReviewSessionsRepo(db: Database): ReviewSessionsRepo {
  return {
    async list(projectId: string): Promise<ReviewSessionRow[]> {
      const rows = await db.select<ReviewSessionSqlRow[]>(
        `${SELECT} WHERE project_id = $1 ORDER BY started_at DESC`,
        [projectId],
      );
      return rows.map(toRow);
    },

    async get(id: string): Promise<ReviewSessionRow | undefined> {
      const rows = await db.select<ReviewSessionSqlRow[]>(`${SELECT} WHERE id = $1`, [id]);
      const row = rows[0];
      return row ? toRow(row) : undefined;
    },

    async latestForProject(projectId: string): Promise<ReviewSessionRow | undefined> {
      const rows = await db.select<ReviewSessionSqlRow[]>(
        `${SELECT} WHERE project_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [projectId],
      );
      const row = rows[0];
      return row ? toRow(row) : undefined;
    },

    async create(input: ReviewSessionCreateInput): Promise<ReviewSessionRow> {
      const id = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      await db.execute(
        `INSERT INTO review_sessions (id, project_id, bundle_id, claude_version, model, effort, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.projectId,
          input.bundleId,
          input.claudeVersion,
          input.model,
          input.effort,
          startedAt,
        ],
      );
      return {
        id,
        projectId: input.projectId,
        bundleId: input.bundleId,
        claudeVersion: input.claudeVersion,
        model: input.model,
        effort: input.effort,
        startedAt,
        completedAt: null,
        appliedAt: null,
      };
    },

    async complete(id: string): Promise<void> {
      await db.execute("UPDATE review_sessions SET completed_at = $1 WHERE id = $2", [
        new Date().toISOString(),
        id,
      ]);
    },

    async markApplied(id: string): Promise<void> {
      await db.execute("UPDATE review_sessions SET applied_at = $1 WHERE id = $2", [
        new Date().toISOString(),
        id,
      ]);
    },
  };
}
