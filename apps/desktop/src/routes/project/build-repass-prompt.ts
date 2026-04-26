import type { Repository } from "@obelus/repo";

export interface BuildRepassPromptInput {
  repo: Repository;
  sessionId: string;
}

// Returns the prompt-body text to append after the standard
// "Run apply-revision with bundle path …" line. Returns null when there is
// nothing to push back — the caller should skip the repass in that case.
export async function buildRepassPrompt(input: BuildRepassPromptInput): Promise<string | null> {
  const { repo, sessionId } = input;
  const hunks = await repo.diffHunks.listForSession(sessionId);

  const responses = hunks.filter((h) => h.noteText.trim() !== "" || h.state === "modified");
  if (responses.length === 0) return null;

  const lines: string[] = [
    "The user has reviewed the previous plan and responded to specific hunks.",
    "Please regenerate the plan taking these responses into account.",
    "",
  ];

  for (const h of responses) {
    const file = h.file === "" ? "(unresolved)" : h.file;
    const headingId = h.annotationIds[0] ?? h.id;
    lines.push(`## ${file}:${headingId}`);
    if (h.annotationIds.length > 1) {
      lines.push(`Satisfies marks: ${h.annotationIds.join(", ")}`);
    }
    if (h.noteText.trim() !== "") {
      lines.push(h.noteText.trim());
    }
    if (h.state === "modified" && h.modifiedPatchText !== null) {
      lines.push("Modified patch the user prefers:");
      lines.push("```diff");
      lines.push(h.modifiedPatchText.trimEnd());
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}
