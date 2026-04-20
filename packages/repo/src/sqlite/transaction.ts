import { invoke } from "@tauri-apps/api/core";

// tauri-plugin-sql gives us a SQLite connection pool but no transaction API.
// Issuing BEGIN / COMMIT as separate `db.execute` calls lands them on
// different pool connections, and SQLite reports "cannot commit - no
// transaction is active" on COMMIT. This primitive hops into the Rust side
// and runs the whole batch on a single `sqlx::Transaction`.
export interface TxStmt {
  sql: string;
  params?: unknown[];
}

const DB_URL = "sqlite:obelus.db";

export async function dbTxBatch(stmts: ReadonlyArray<TxStmt>): Promise<void> {
  if (stmts.length === 0) return;
  await invoke("db_tx_batch", {
    db: DB_URL,
    stmts: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
  });
}
