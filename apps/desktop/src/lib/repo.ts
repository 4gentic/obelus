import type { Repository } from "@obelus/repo";
import { buildSqliteRepository, getDb } from "@obelus/repo/sqlite";

let singleton: Promise<Repository> | null = null;

export function getRepository(): Promise<Repository> {
  if (!singleton) {
    singleton = getDb().then(buildSqliteRepository);
  }
  return singleton;
}
