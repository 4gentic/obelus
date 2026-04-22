import { check } from "@tauri-apps/plugin-updater";

// Possible states when the app asks the updater about a new release.
// `unconfigured` surfaces when tauri.conf.json still has an empty pubkey;
// `offline` and `no-release` distinguish the two benign failure modes
// the Tauri plugin doesn't itself name, so the UI can render calm copy
// instead of leaking a raw deserializer error.
export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "installed" }
  | { kind: "offline" }
  | { kind: "no-release" }
  | { kind: "error"; message: string; raw: string }
  | { kind: "unconfigured" };

function classifyError(err: unknown): UpdaterState {
  const raw = err instanceof Error ? err.message : String(err);
  if (/pubkey|public key|signing|signature|minisign/i.test(raw)) {
    return { kind: "unconfigured" };
  }
  if (/network|failed to fetch|connection|dns|timeout|unreachable/i.test(raw)) {
    return { kind: "offline" };
  }
  if (/404|not found|expected value|eof|unexpected|json|deserialize|missing field/i.test(raw)) {
    return { kind: "no-release" };
  }
  return { kind: "error", message: "Update check failed.", raw };
}

export async function checkForUpdate(): Promise<UpdaterState> {
  try {
    const update = await check();
    if (update === null) return { kind: "current" };
    return {
      kind: "available",
      version: update.version,
      notes: update.body ?? null,
    };
  } catch (err) {
    return classifyError(err);
  }
}

export async function downloadAndInstall(
  onProgress?: (state: UpdaterState) => void,
): Promise<UpdaterState> {
  try {
    const update = await check();
    if (update === null) return { kind: "current" };
    let downloaded = 0;
    let total: number | null = null;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
        onProgress?.({ kind: "downloading", downloaded: 0, total });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress?.({ kind: "downloading", downloaded, total });
      } else if (event.event === "Finished") {
        onProgress?.({ kind: "installed" });
      }
    });
    return { kind: "installed" };
  } catch (err) {
    return classifyError(err);
  }
}
