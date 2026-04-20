import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:obelus.db";

let singleton: Database | null = null;

// `Database.load` triggers the Rust-side migrations registered with
// tauri-plugin-sql; we expose a lazy accessor so tests can inject a mock.
export async function getDb(): Promise<Database> {
  if (!singleton) {
    singleton = await Database.load(DB_URL);
  }
  return singleton;
}

export function setDbForTests(db: Database | null): void {
  singleton = db;
}

export type { Database };
