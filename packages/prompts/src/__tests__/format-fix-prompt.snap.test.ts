import { describe, expect, it } from "vitest";
import { formatFixPrompt, type PromptInput } from "../formatters/format-fix-prompt.js";

function fixture(): PromptInput {
  return {
    paper: {
      title: "Paper",
      revisionNumber: 1,
      entrypoint: "paper.pdf",
      sha256: "a".repeat(64),
    },
    annotations: [
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        category: "unclear",
        quote: "The results were good.",
        contextBefore: "prior ",
        contextAfter: " next",
        note: "How good?",
        locator: { kind: "pdf", file: "paper.pdf", page: 3 },
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440002",
        category: "citation-needed",
        quote: "Vaswani et al.",
        contextBefore: "as in ",
        contextAfter: " (citation pending)",
        note: "needs full \\cite",
        locator: { kind: "source", file: "main.tex", lineStart: 142, lineEnd: 142 },
      },
    ],
  };
}

describe("formatFixPrompt", () => {
  it("emits the entrypoint header, locator-shaped annotations, and untrusted-data fences", () => {
    const text = formatFixPrompt(fixture());
    expect(text).toContain('# Review for "Paper" (revision 1)');
    expect(text).toContain(
      "Source: `paper.pdf` (sha256 `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)",
    );
    expect(text).toContain("- In `paper.pdf`, on page 3 (unclear):");
    expect(text).toContain("Quote: <obelus:quote>The results were good.</obelus:quote>");
    expect(text).toContain("Note: <obelus:note>How good?</obelus:note>");
    expect(text).toContain(
      "Context: <obelus:context-before>prior </obelus:context-before>…<obelus:context-after> next</obelus:context-after>",
    );
    expect(text).toContain("- In `main.tex`, line 142 (citation-needed):");
  });

  it("emits just the entrypoint when no sha256 is provided", () => {
    const text = formatFixPrompt({
      paper: { title: "Notes", revisionNumber: 2, entrypoint: "main.md" },
      annotations: [
        {
          id: "550e8400-e29b-41d4-a716-446655440003",
          category: "rephrase",
          quote: "x",
          contextBefore: "",
          contextAfter: "",
          note: "",
          locator: { kind: "source", file: "main.md", lineStart: 1, lineEnd: 1 },
        },
      ],
    });
    expect(text).toContain("Source: `main.md`");
    expect(text).not.toContain("sha256");
  });
});
