import type { AskMessageRow } from "@obelus/repo";

const RECENT_TURNS = 6;
const RECENT_BUDGET_BYTES = 2048;

export interface AskPromptInput {
  projectLabel: string;
  projectRoot: string;
  openPaperRelPath: string | null;
  selectedQuote: { quote: string; category?: string | null } | null;
  recent: ReadonlyArray<Pick<AskMessageRow, "role" | "body">>;
  question: string;
}

function trimQuote(s: string, max = 240): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function recentSlice(
  recent: ReadonlyArray<Pick<AskMessageRow, "role" | "body">>,
): ReadonlyArray<Pick<AskMessageRow, "role" | "body">> {
  if (recent.length === 0) return recent;
  const tail = recent.slice(-RECENT_TURNS);
  let total = 0;
  const kept: Array<Pick<AskMessageRow, "role" | "body">> = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = tail[i];
    if (!m) continue;
    const size = m.body.length + m.role.length + 4;
    if (total + size > RECENT_BUDGET_BYTES) break;
    kept.unshift(m);
    total += size;
  }
  return kept;
}

export function buildAskPrompt(input: AskPromptInput): string {
  const lines: string[] = [
    "You are answering a question about a local project.",
    "You may read files in the project (Read, Glob, Grep). Do not propose edits or run shells — for changes the user uses a separate diff flow.",
    "Be direct. Cite file paths and line numbers when relevant.",
    "",
    `Project: ${input.projectLabel} (${input.projectRoot})`,
  ];

  if (input.openPaperRelPath !== null) {
    lines.push(`Open paper: ${input.openPaperRelPath}`);
  }
  if (input.selectedQuote !== null) {
    const cat = input.selectedQuote.category ? ` — ${input.selectedQuote.category}` : "";
    lines.push(`Selected mark${cat}: "${trimQuote(input.selectedQuote.quote)}"`);
  }

  const turns = recentSlice(input.recent);
  if (turns.length > 0) {
    lines.push("", "Recent turns:");
    for (const m of turns) {
      const label = m.role === "user" ? "Q" : "A";
      lines.push(`${label}: ${m.body.trim()}`);
    }
  }

  lines.push("", "Question:", input.question.trim());
  return lines.join("\n");
}
