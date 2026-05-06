import { invoke } from "@tauri-apps/api/core";
import { clearAppState } from "../store/app-state";

// Clears all app-state keys (wizard checkpoint, engine-detect caches, preferred
// engine, panel state, …). Projects, papers, annotations, and everything in
// SQLite survive.
export async function wizardReset(): Promise<void> {
  await clearAppState();
}

// Wipes every user row in SQLite (schema and migration ledger stay intact)
// and every key in the Tauri plugin-store. Source files on disk are untouched.
export async function factoryReset(): Promise<void> {
  await invoke("factory_reset");
  await clearAppState();
}
