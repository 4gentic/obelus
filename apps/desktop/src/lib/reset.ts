import { dbTxBatch } from "@obelus/repo/sqlite";
import { clearAppState } from "../store/app-state";

// Clears the Tauri plugin-store only: wizard checkpoint + Claude-detect cache.
// Projects, papers, annotations, and everything in SQLite survive.
export async function wizardReset(): Promise<void> {
  await clearAppState();
}

// Wipes every row of user data: SQLite tables + Tauri plugin-store.
export async function factoryReset(): Promise<void> {
  await dbTxBatch([
    { sql: "DELETE FROM writeups" },
    { sql: "DELETE FROM ask_messages" },
    { sql: "DELETE FROM ask_threads" },
    { sql: "DELETE FROM diff_hunks" },
    { sql: "DELETE FROM review_sessions" },
    { sql: "DELETE FROM annotations" },
    { sql: "DELETE FROM revisions" },
    { sql: "DELETE FROM papers" },
    { sql: "DELETE FROM projects" },
    { sql: "DELETE FROM settings" },
  ]);
  await clearAppState();
}
