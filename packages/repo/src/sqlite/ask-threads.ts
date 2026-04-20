import type { AskMessageAppendInput, AskThreadsRepo } from "../interface";
import type { AskMessageRole, AskMessageRow, AskThreadRow } from "../types";
import type { Database } from "./db";

interface AskThreadSqlRow {
  id: string;
  project_id: string;
  paper_id: string | null;
  created_at: string;
}

interface AskMessageSqlRow {
  id: string;
  thread_id: string;
  role: AskMessageRole;
  body: string;
  created_at: string;
  cancelled: number;
}

function toThread(r: AskThreadSqlRow): AskThreadRow {
  return {
    id: r.id,
    projectId: r.project_id,
    paperId: r.paper_id,
    createdAt: r.created_at,
  };
}

function toMessage(r: AskMessageSqlRow): AskMessageRow {
  return {
    id: r.id,
    threadId: r.thread_id,
    role: r.role,
    body: r.body,
    createdAt: r.created_at,
    cancelled: r.cancelled === 1,
  };
}

const SELECT_THREAD = "SELECT id, project_id, paper_id, created_at FROM ask_threads";
const SELECT_MESSAGE = "SELECT id, thread_id, role, body, created_at, cancelled FROM ask_messages";

export function buildAskThreadsRepo(db: Database): AskThreadsRepo {
  return {
    async getOrCreate(projectId: string, paperId: string | null): Promise<AskThreadRow> {
      const existing = await db.select<AskThreadSqlRow[]>(
        paperId === null
          ? `${SELECT_THREAD} WHERE project_id = $1 AND paper_id IS NULL LIMIT 1`
          : `${SELECT_THREAD} WHERE project_id = $1 AND paper_id = $2 LIMIT 1`,
        paperId === null ? [projectId] : [projectId, paperId],
      );
      const found = existing[0];
      if (found) return toThread(found);

      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      await db.execute(
        `INSERT INTO ask_threads (id, project_id, paper_id, created_at)
         VALUES ($1, $2, $3, $4)`,
        [id, projectId, paperId, createdAt],
      );
      return { id, projectId, paperId, createdAt };
    },

    async listMessages(threadId: string): Promise<AskMessageRow[]> {
      const rows = await db.select<AskMessageSqlRow[]>(
        `${SELECT_MESSAGE} WHERE thread_id = $1 ORDER BY created_at ASC, id ASC`,
        [threadId],
      );
      return rows.map(toMessage);
    },

    async appendMessage(threadId: string, input: AskMessageAppendInput): Promise<AskMessageRow> {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const cancelled = input.cancelled === true ? 1 : 0;
      await db.execute(
        `INSERT INTO ask_messages (id, thread_id, role, body, created_at, cancelled)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, threadId, input.role, input.body, createdAt, cancelled],
      );
      return {
        id,
        threadId,
        role: input.role,
        body: input.body,
        createdAt,
        cancelled: cancelled === 1,
      };
    },

    async updateMessage(id: string, patch: { body?: string; cancelled?: boolean }): Promise<void> {
      const sets: string[] = [];
      const args: unknown[] = [];
      let i = 1;
      if (patch.body !== undefined) {
        sets.push(`body = $${i++}`);
        args.push(patch.body);
      }
      if (patch.cancelled !== undefined) {
        sets.push(`cancelled = $${i++}`);
        args.push(patch.cancelled ? 1 : 0);
      }
      if (sets.length === 0) return;
      args.push(id);
      await db.execute(`UPDATE ask_messages SET ${sets.join(", ")} WHERE id = $${i}`, args);
    },

    async clear(threadId: string): Promise<void> {
      await db.execute("DELETE FROM ask_messages WHERE thread_id = $1", [threadId]);
    },
  };
}
