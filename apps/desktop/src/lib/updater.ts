import { check } from "@tauri-apps/plugin-updater";

// Possible states when the app asks the updater about a new release.
// `unconfigured` only surfaces when tauri.conf.json still has an empty
// `pubkey`; in that state we refuse to trust manifests and keep quiet.
export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "installed" }
  | { kind: "error"; message: string }
  | { kind: "unconfigured" };

// Thin wrapper that normalizes the plugin's thrown "no key configured"
// error into a quiet `unconfigured` state so the UI can hide the control.
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
    const message = err instanceof Error ? err.message : String(err);
    if (/pubkey|public key|signing/i.test(message)) {
      return { kind: "unconfigured" };
    }
    return { kind: "error", message };
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
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}
