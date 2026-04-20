import { type ClaudeStatus, detectClaude } from "../ipc/commands";
import { getAppState, setAppState } from "../store/app-state";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

// Detection is cheap (~50ms) but we cache it so the wizard's first folio
// paints instantly on subsequent launches; a full re-check is one click away.
export async function readClaudeStatus(force = false): Promise<ClaudeStatus> {
  if (!force) {
    const cached = await getAppState("claudeDetectCache");
    if (cached && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) {
      return cached.status;
    }
  }
  const status = await detectClaude();
  await setAppState("claudeDetectCache", {
    status,
    checkedAt: new Date().toISOString(),
  });
  return status;
}
