import type { Repository } from "@obelus/repo";

// Short paragraph listing recent drafts for *this paper* so Claude sees what
// earlier passes already landed and doesn't re-litigate finished work. Skipped
// (returns "") when there is only a baseline — the first AI pass has nothing
// to recap.
export async function buildPriorDraftsPrompt(repo: Repository, paperId: string): Promise<string> {
  const edits = await repo.paperEdits.listForPaper(paperId);
  const landed = edits.filter((e) => e.kind === "ai" || e.kind === "manual");
  if (landed.length === 0) return "";

  // Cap at the last six — the prompt grows linearly and the earliest drafts
  // are already reflected in the current working tree anyway.
  const tail = landed.slice(-6);
  const lines: string[] = ["", "## Prior drafts on this paper", ""];
  for (const e of tail) {
    const note = e.noteMd.trim();
    const summary = e.summary.trim() || "untitled";
    const suffix = note ? ` — ${note}` : "";
    lines.push(`- Draft ${e.ordinal}: ${summary}${suffix}`);
  }
  lines.push("");
  lines.push(
    "The working tree already reflects these drafts. Do not re-litigate edits the user already kept. Focus only on the current marks.",
  );
  lines.push("");
  return lines.join("\n");
}
