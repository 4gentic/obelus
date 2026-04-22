import { invoke } from "@tauri-apps/api/core";
import { clearAppState } from "../store/app-state";

// Clears the Tauri plugin-store only: wizard checkpoint + Claude-detect cache.
// Projects, papers, annotations, and everything in SQLite survive.
export async function wizardReset(): Promise<void> {
  await clearAppState();
}

// Wipes every user row in SQLite (schema and migration ledger stay intact)
// and every key in the Tauri plugin-store. Source files on disk are untouched.
export async function factoryReset(): Promise<void> {
  await invoke("factory_reset");
  await clearAppState();
}
