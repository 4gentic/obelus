import type { SettingsRepo } from "../interface";
import type { Database } from "./db";

interface SettingSqlRow {
  key: string;
  value_json: string;
}

export function buildSettingsRepo(db: Database): SettingsRepo {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const rows = await db.select<SettingSqlRow[]>(
        "SELECT key, value_json FROM settings WHERE key = $1",
        [key],
      );
      const row = rows[0];
      if (!row) return undefined;
      return JSON.parse(row.value_json) as T;
    },

    async set<T>(key: string, value: T): Promise<void> {
      const json = JSON.stringify(value);
      await db.execute(
        `INSERT INTO settings (key, value_json) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
        [key, json],
      );
    },
  };
}
