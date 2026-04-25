import { describe, expect, it } from "vitest";
import type { PromptInput, PromptRubric } from "../formatters/format-fix-prompt.js";
import { formatReviewPrompt } from "../formatters/format-review-prompt.js";

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
    ],
  };
}

const rubric: PromptRubric = {
  label: "neurips-rubric.md",
  body: ["## Novelty", "Is the work novel?"].join("\n"),
};

describe("formatReviewPrompt", () => {
  it("emits the letter header, voice/output-shape sections, and the locator-shaped annotation", () => {
    const text = formatReviewPrompt(fixture());
    expect(text).toContain('# Review write-up for "Paper" (revision 1)');
    expect(text).toContain(
      "Source: `paper.pdf` (sha256 `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)",
    );
    expect(text).toContain("Generate a peer-review letter");
    expect(text).toContain("## Voice");
    expect(text).toContain("## Output shape");
    expect(text).toContain("## Major comments");
    expect(text).toContain("## Minor comments");
    expect(text).toContain("## Refusals");
    expect(text).toContain("Do not edit any source file.");
    expect(text).toContain("- In `paper.pdf`, on page 3 (unclear):");
    expect(text).toContain("Quote: <obelus:quote>The results were good.</obelus:quote>");
  });

  it("appends the rubric framing when a rubric is attached", () => {
    const text = formatReviewPrompt({ ...fixture(), rubric });
    expect(text).toContain("## Rubric framing");
    expect(text).toContain("Source: neurips-rubric.md");
    expect(text).toContain("<obelus:rubric>## Novelty\nIs the work novel?</obelus:rubric>");
  });

  it("omits the rubric framing when no rubric is attached", () => {
    const text = formatReviewPrompt(fixture());
    expect(text).not.toContain("## Rubric framing");
    // The prompt mentions `<obelus:rubric>` in the explanatory header; the
    // closing tag only appears when a rubric body is actually rendered.
    expect(text).not.toContain("</obelus:rubric>");
  });
});
