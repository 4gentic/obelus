import type { PaperBuildPatch, PaperBuildRepo } from "../interface";
import type { PaperBuildCompiler, PaperBuildFormat, PaperBuildRow } from "../types";
import type { Database } from "./db";

interface PaperBuildSqlRow {
  paper_id: string;
  format: PaperBuildFormat | null;
  main_rel_path: string | null;
  main_is_pinned: number;
  compiler: PaperBuildCompiler | null;
  compiler_args_json: string;
  output_rel_dir: string | null;
  scanned_at: string | null;
  updated_at: string;
}

function toRow(r: PaperBuildSqlRow): PaperBuildRow {
  let compilerArgs: string[] = [];
  try {
    const parsed = JSON.parse(r.compiler_args_json) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      compilerArgs = parsed as string[];
    }
  } catch {
    compilerArgs = [];
  }
  return {
    paperId: r.paper_id,
    format: r.format,
    mainRelPath: r.main_rel_path,
    mainIsPinned: r.main_is_pinned !== 0,
    compiler: r.compiler,
    compilerArgs,
    outputRelDir: r.output_rel_dir,
    scannedAt: r.scanned_at,
    updatedAt: r.updated_at,
  };
}

const SELECT_COLS = `paper_id, format, main_rel_path, main_is_pinned,
                     compiler, compiler_args_json, output_rel_dir,
                     scanned_at, updated_at`;

async function loadRow(db: Database, paperId: string): Promise<PaperBuildRow | undefined> {
  const rows = await db.select<PaperBuildSqlRow[]>(
    `SELECT ${SELECT_COLS} FROM paper_build WHERE paper_id = $1 LIMIT 1`,
    [paperId],
  );
  return rows[0] ? toRow(rows[0]) : undefined;
}

export function buildPaperBuildRepo(db: Database): PaperBuildRepo {
  async function upsert(paperId: string, patch: PaperBuildPatch): Promise<PaperBuildRow> {
    const existing = await loadRow(db, paperId);
    const now = new Date().toISOString();
    const next: PaperBuildRow = {
      paperId,
      format: patch.format !== undefined ? patch.format : (existing?.format ?? null),
      mainRelPath:
        patch.mainRelPath !== undefined ? patch.mainRelPath : (existing?.mainRelPath ?? null),
      mainIsPinned:
        patch.mainIsPinned !== undefined ? patch.mainIsPinned : (existing?.mainIsPinned ?? false),
      compiler: patch.compiler !== undefined ? patch.compiler : (existing?.compiler ?? null),
      compilerArgs:
        patch.compilerArgs !== undefined ? patch.compilerArgs : (existing?.compilerArgs ?? []),
      outputRelDir:
        patch.outputRelDir !== undefined ? patch.outputRelDir : (existing?.outputRelDir ?? null),
      scannedAt: patch.scannedAt !== undefined ? patch.scannedAt : (existing?.scannedAt ?? null),
      updatedAt: now,
    };
    await db.execute(
      `INSERT INTO paper_build
         (paper_id, format, main_rel_path, main_is_pinned,
          compiler, compiler_args_json, output_rel_dir, scanned_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(paper_id) DO UPDATE SET
         format = excluded.format,
         main_rel_path = excluded.main_rel_path,
         main_is_pinned = excluded.main_is_pinned,
         compiler = excluded.compiler,
         compiler_args_json = excluded.compiler_args_json,
         output_rel_dir = excluded.output_rel_dir,
         scanned_at = excluded.scanned_at,
         updated_at = excluded.updated_at`,
      [
        next.paperId,
        next.format,
        next.mainRelPath,
        next.mainIsPinned ? 1 : 0,
        next.compiler,
        JSON.stringify(next.compilerArgs),
        next.outputRelDir,
        next.scannedAt,
        next.updatedAt,
      ],
    );
    return next;
  }

  return {
    async get(paperId: string): Promise<PaperBuildRow | undefined> {
      return loadRow(db, paperId);
    },

    upsert,

    async setMain(
      paperId: string,
      relPath: string | null,
      pinned: boolean,
    ): Promise<PaperBuildRow> {
      return upsert(paperId, { mainRelPath: relPath, mainIsPinned: pinned });
    },
  };
}
