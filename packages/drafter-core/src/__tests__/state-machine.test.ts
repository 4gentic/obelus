import { describe, expect, it } from "vitest";
import { PaperDraft, type Stage } from "../draft-state.js";
import { canAdvance, nextStages } from "../state-machine.js";

describe("paper-draft schema", () => {
  it("round-trips a minimal single-paper draft", () => {
    const input: unknown = {
      version: "1.0",
      papers: [{ slug: "main", title: "Main paper", goalPath: "paper/main/goal.md" }],
      sections: [
        {
          paperSlug: "main",
          slug: "introduction",
          title: "Introduction",
          ordinal: 1,
          stage: "spec",
          sourcePath: "paper/main/sections/01-introduction/draft.md",
          lastUpdated: "2026-04-23T12:00:00.000Z",
        },
      ],
    };
    const parsed = PaperDraft.parse(input);
    expect(parsed.sections[0]?.stage).toBe("spec");
    expect(parsed.sections[0]?.specPath).toBeUndefined();
  });

  it("round-trips a multi-paper draft (journal + workshop)", () => {
    const parsed = PaperDraft.parse({
      version: "1.0",
      papers: [
        { slug: "journal", title: "Journal version", goalPath: "paper/journal/goal.md" },
        { slug: "workshop", title: "Workshop version", goalPath: "paper/workshop/goal.md" },
      ],
      sections: [
        {
          paperSlug: "journal",
          slug: "introduction",
          title: "Introduction",
          ordinal: 1,
          stage: "draft",
          sourcePath: "paper/journal/sections/01-introduction/draft.md",
          lastUpdated: "2026-04-23T12:00:00.000Z",
        },
        {
          paperSlug: "workshop",
          slug: "introduction",
          title: "Introduction",
          ordinal: 1,
          stage: "spec",
          sourcePath: "paper/workshop/sections/01-introduction/draft.md",
          lastUpdated: "2026-04-23T12:00:00.000Z",
        },
      ],
    });
    expect(parsed.papers).toHaveLength(2);
    expect(parsed.sections.map((s) => s.paperSlug)).toEqual(["journal", "workshop"]);
  });

  it("accepts an optional specPath", () => {
    const parsed = PaperDraft.parse({
      version: "1.0",
      papers: [{ slug: "main", title: "Main paper", goalPath: "paper/main/goal.md" }],
      sections: [
        {
          paperSlug: "main",
          slug: "related-work",
          title: "Related Work",
          ordinal: 2,
          stage: "research",
          sourcePath: "paper/main/sections/02-related-work/draft.md",
          specPath: "paper/main/sections/02-related-work/spec.md",
          lastUpdated: "2026-04-23T12:01:00.000Z",
        },
      ],
    });
    expect(parsed.sections[0]?.specPath).toBe("paper/main/sections/02-related-work/spec.md");
  });

  it("rejects an unknown stage", () => {
    const result = PaperDraft.safeParse({
      version: "1.0",
      papers: [{ slug: "main", title: "Main paper", goalPath: "paper/main/goal.md" }],
      sections: [
        {
          paperSlug: "main",
          slug: "introduction",
          title: "Introduction",
          ordinal: 1,
          stage: "rewrite",
          sourcePath: "paper/main/sections/01-introduction/draft.md",
          lastUpdated: "2026-04-23T12:00:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a slug with uppercase letters", () => {
    const result = PaperDraft.safeParse({
      version: "1.0",
      papers: [{ slug: "main", title: "Main paper", goalPath: "paper/main/goal.md" }],
      sections: [
        {
          paperSlug: "main",
          slug: "Introduction",
          title: "Introduction",
          ordinal: 1,
          stage: "spec",
          sourcePath: "paper/main/sections/01-introduction/draft.md",
          lastUpdated: "2026-04-23T12:00:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-1.0 version", () => {
    const result = PaperDraft.safeParse({
      version: "2.0",
      papers: [{ slug: "main", title: "Main paper", goalPath: "paper/main/goal.md" }],
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a draft with zero papers", () => {
    const result = PaperDraft.safeParse({
      version: "1.0",
      papers: [],
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate paper slugs", () => {
    const result = PaperDraft.safeParse({
      version: "1.0",
      papers: [
        { slug: "main", title: "First", goalPath: "paper/main/goal.md" },
        { slug: "main", title: "Second", goalPath: "paper/main/goal.md" },
      ],
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a section whose paperSlug is not in papers[]", () => {
    const result = PaperDraft.safeParse({
      version: "1.0",
      papers: [{ slug: "main", title: "Main paper", goalPath: "paper/main/goal.md" }],
      sections: [
        {
          paperSlug: "ghost",
          slug: "introduction",
          title: "Introduction",
          ordinal: 1,
          stage: "spec",
          sourcePath: "paper/ghost/sections/01-introduction/draft.md",
          lastUpdated: "2026-04-23T12:00:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("state-machine transitions", () => {
  // Table-driven: every (from, to) combination, with the expected verdict.
  // `iterate` re-enters research or draft; `assemble` is terminal.
  const cases: ReadonlyArray<readonly [Stage, Stage, boolean]> = [
    ["spec", "research", true],
    ["spec", "draft", false],
    ["spec", "critique", false],
    ["spec", "iterate", false],
    ["spec", "assemble", false],
    ["research", "draft", true],
    ["research", "spec", false],
    ["research", "critique", false],
    ["draft", "critique", true],
    ["draft", "research", false],
    ["draft", "iterate", false],
    ["critique", "iterate", true],
    ["critique", "assemble", true],
    ["critique", "draft", false],
    ["iterate", "research", true],
    ["iterate", "draft", true],
    ["iterate", "critique", false],
    ["iterate", "assemble", false],
    ["assemble", "spec", false],
    ["assemble", "research", false],
    ["assemble", "draft", false],
    ["assemble", "critique", false],
    ["assemble", "iterate", false],
  ];

  it.each(cases)("canAdvance(%s, %s) === %s", (from, to, expected) => {
    expect(canAdvance(from, to)).toBe(expected);
  });

  it("nextStages('spec') returns ['research']", () => {
    expect(nextStages("spec")).toEqual(["research"]);
  });

  it("nextStages('critique') returns ['iterate', 'assemble']", () => {
    expect(nextStages("critique")).toEqual(["iterate", "assemble"]);
  });

  it("nextStages('assemble') returns []", () => {
    expect(nextStages("assemble")).toEqual([]);
  });
});
