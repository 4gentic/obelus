import { describe, expect, it } from "vitest";
import { PlanFile, pickLatestPlanName, pickLatestWriteupName } from "../plan";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID_2 = "22222222-2222-4222-8222-222222222222";

function block(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    annotationIds: [USER_ID],
    file: "intro.tex",
    category: "elaborate",
    patch: "@@ -1 +1 @@\n-old\n+new\n",
    ambiguous: false,
    reviewerNotes: "",
    emptyReason: null,
    ...overrides,
  };
}

function envelope(blocks: ReadonlyArray<unknown>): unknown {
  return {
    bundleId: "sha256:abc",
    format: "typst",
    entrypoint: "main.typ",
    blocks,
  };
}

describe("PlanFile schema", () => {
  it("accepts a single-mark block with a real patch", () => {
    const parsed = PlanFile.parse(envelope([block()]));
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.annotationIds).toEqual([USER_ID]);
    expect(parsed.blocks[0]?.emptyReason).toBeNull();
  });

  it("accepts a multi-mark block where one diff satisfies several marks", () => {
    const parsed = PlanFile.parse(envelope([block({ annotationIds: [USER_ID, USER_ID_2] })]));
    expect(parsed.blocks[0]?.annotationIds).toHaveLength(2);
  });

  it("accepts an empty-string format and entrypoint when no descriptor was available", () => {
    const parsed = PlanFile.parse({
      bundleId: "sha256:abc",
      format: "",
      entrypoint: "",
      blocks: [],
    });
    expect(parsed.format).toBe("");
    expect(parsed.entrypoint).toBe("");
  });

  it("accepts html format", () => {
    const parsed = PlanFile.parse({
      bundleId: "sha256:abc",
      format: "html",
      entrypoint: "index.html",
      blocks: [],
    });
    expect(parsed.format).toBe("html");
  });

  it("rejects a format value outside the enum", () => {
    expect(() =>
      PlanFile.parse({
        bundleId: "sha256:abc",
        format: "docx",
        entrypoint: "main.docx",
        blocks: [],
      }),
    ).toThrow();
  });

  it("rejects a missing annotationIds field", () => {
    expect(() =>
      PlanFile.parse(envelope([{ file: "intro.tex", patch: "@@ -1 +1 @@\n-x\n+y\n" }])),
    ).toThrow();
  });

  it("rejects an empty annotationIds array", () => {
    expect(() => PlanFile.parse(envelope([block({ annotationIds: [] })]))).toThrow();
  });
});

describe("PlanBlock empty-patch invariants", () => {
  it("rejects an empty patch with no emptyReason (the regression case)", () => {
    expect(() =>
      PlanFile.parse(envelope([block({ category: "wrong", patch: "", emptyReason: null })])),
    ).toThrow(/empty patch requires an emptyReason/);
  });

  it("accepts a praise mark with empty patch and emptyReason 'praise'", () => {
    const parsed = PlanFile.parse(
      envelope([block({ category: "praise", patch: "", emptyReason: "praise" })]),
    );
    expect(parsed.blocks[0]?.emptyReason).toBe("praise");
  });

  it("accepts an aside / flag mark with empty patch and emptyReason 'no-edit-requested'", () => {
    const parsed = PlanFile.parse(
      envelope([block({ category: "note", patch: "", emptyReason: "no-edit-requested" })]),
    );
    expect(parsed.blocks[0]?.emptyReason).toBe("no-edit-requested");
  });

  it("accepts ambiguous: true with empty patch and emptyReason 'ambiguous'", () => {
    const parsed = PlanFile.parse(
      envelope([
        block({
          category: "wrong",
          patch: "",
          ambiguous: true,
          emptyReason: "ambiguous",
          reviewerNotes: "Couldn't locate this mark in the source.",
        }),
      ]),
    );
    expect(parsed.blocks[0]?.ambiguous).toBe(true);
    expect(parsed.blocks[0]?.emptyReason).toBe("ambiguous");
  });

  it("rejects ambiguous: true with a non-empty patch", () => {
    expect(() => PlanFile.parse(envelope([block({ ambiguous: true })]))).toThrow(
      /ambiguous: true requires patch/,
    );
  });

  it("rejects emptyReason 'ambiguous' without ambiguous: true", () => {
    expect(() =>
      PlanFile.parse(envelope([block({ patch: "", emptyReason: "ambiguous", ambiguous: false })])),
    ).toThrow(/emptyReason 'ambiguous' requires ambiguous: true/);
  });

  it("rejects a non-empty patch carrying an emptyReason", () => {
    expect(() => PlanFile.parse(envelope([block({ emptyReason: "praise" })]))).toThrow(
      /non-empty patch must not carry an emptyReason/,
    );
  });

  it("accepts an impact-* block with empty patch + structural-note", () => {
    const parsed = PlanFile.parse(
      envelope([
        block({
          annotationIds: ["impact-abcd1234-1"],
          category: "elaborate",
          patch: "",
          emptyReason: "structural-note",
          reviewerNotes: "Impact of <id>: section 3 narrowing.",
        }),
      ]),
    );
    expect(parsed.blocks[0]?.annotationIds).toEqual(["impact-abcd1234-1"]);
  });

  it("rejects an impact-* block carrying a non-empty patch", () => {
    expect(() =>
      PlanFile.parse(envelope([block({ annotationIds: ["impact-abcd1234-1"] })])),
    ).toThrow(/impact-\* blocks must carry an empty patch/);
  });

  it("rejects emptyReason 'structural-note' on a user-mark block", () => {
    expect(() =>
      PlanFile.parse(envelope([block({ patch: "", emptyReason: "structural-note" })])),
    ).toThrow(/'structural-note' is only valid on impact-\/coherence- blocks/);
  });

  it("accepts a cascade-* block with a real patch", () => {
    const parsed = PlanFile.parse(
      envelope([
        block({
          annotationIds: ["cascade-abcd1234-1"],
          reviewerNotes: "Cascaded from <id>: same-referent rename.",
        }),
      ]),
    );
    expect(parsed.blocks[0]?.annotationIds).toEqual(["cascade-abcd1234-1"]);
  });

  it("rejects an impact-* block with empty reviewerNotes", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["impact-abcd1234-1"],
            category: "elaborate",
            patch: "",
            emptyReason: "structural-note",
            reviewerNotes: "",
          }),
        ]),
      ),
    ).toThrow(/structural-note blocks require non-empty reviewerNotes/);
  });

  it("rejects an impact-* block whose reviewerNotes lacks the 'Impact of ' prefix", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["impact-abcd1234-1"],
            category: "elaborate",
            patch: "",
            emptyReason: "structural-note",
            reviewerNotes: "Section 3 still depends on the withdrawn assumption.",
          }),
        ]),
      ),
    ).toThrow(/impact-\* blocks require reviewerNotes starting with/);
  });

  it("rejects an impact-* block whose reviewerNotes is the bare prefix", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["impact-abcd1234-1"],
            category: "elaborate",
            patch: "",
            emptyReason: "structural-note",
            reviewerNotes: "Impact of ",
          }),
        ]),
      ),
    ).toThrow(/substantive reviewerNotes after the/);
  });

  it("rejects a cascade-* block whose reviewerNotes lacks the 'Cascaded from ' prefix", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["cascade-abcd1234-1"],
            reviewerNotes: "same-referent rename without the prefix",
          }),
        ]),
      ),
    ).toThrow(/cascade-\* blocks require reviewerNotes starting with/);
  });

  it("rejects a coherence-* block with empty reviewerNotes", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["coherence-1"],
            category: "elaborate",
            patch: "",
            emptyReason: "structural-note",
            reviewerNotes: "",
          }),
        ]),
      ),
    ).toThrow(/structural-note blocks require non-empty reviewerNotes/);
  });

  it("accepts a coherence-* block with non-empty notes (no prefix required)", () => {
    const parsed = PlanFile.parse(
      envelope([
        block({
          annotationIds: ["coherence-1"],
          category: "elaborate",
          patch: "",
          emptyReason: "structural-note",
          reviewerNotes: "Marks ...440001 and ...440002 disagree on 'estimator' vs 'algorithm'.",
        }),
      ]),
    );
    expect(parsed.blocks[0]?.annotationIds).toEqual(["coherence-1"]);
  });

  it("rejects a quality-* block whose reviewerNotes lacks the 'Quality pass: ' prefix", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["quality-intro-1"],
            reviewerNotes: "Removed boilerplate hedging triad.",
          }),
        ]),
      ),
    ).toThrow(/quality-\* blocks require reviewerNotes starting with/);
  });

  it("accepts a quality-* block with substantive prefixed notes", () => {
    const parsed = PlanFile.parse(
      envelope([
        block({
          annotationIds: ["quality-intro-1"],
          reviewerNotes: "Quality pass: removed boilerplate hedging triad.",
        }),
      ]),
    );
    expect(parsed.blocks[0]?.annotationIds).toEqual(["quality-intro-1"]);
  });

  it("rejects a directive-* block whose reviewerNotes lacks the 'Directive: ' prefix", () => {
    expect(() =>
      PlanFile.parse(
        envelope([
          block({
            annotationIds: ["directive-abcd1234-1"],
            reviewerNotes: "Tightened a vague claim per author indications.",
          }),
        ]),
      ),
    ).toThrow(/directive-\* blocks require reviewerNotes starting with/);
  });

  it("accepts a directive-* block with substantive prefixed notes", () => {
    const parsed = PlanFile.parse(
      envelope([
        block({
          annotationIds: ["directive-abcd1234-1"],
          reviewerNotes: "Directive: tightened a vague claim per author indications.",
        }),
      ]),
    );
    expect(parsed.blocks[0]?.annotationIds).toEqual(["directive-abcd1234-1"]);
  });
});

describe("pickLatestPlanName", () => {
  it("picks the lexicographically greatest plan-*.json", () => {
    const picked = pickLatestPlanName([
      "plan-20260101-0000.json",
      "plan-20260419-2200.json",
      "plan-20260201-1030.json",
      "bundle-20260419.json",
    ]);
    expect(picked).toBe("plan-20260419-2200.json");
  });

  it("returns null when no plan is present", () => {
    expect(pickLatestPlanName(["bundle-x.json", "readme.md"])).toBeNull();
  });

  it("falls back to bare plan.json when no timestamped plan exists", () => {
    expect(pickLatestPlanName(["plan.json", "bundle-x.json"])).toBe("plan.json");
  });

  it("prefers timestamped plan over bare plan.json when both exist", () => {
    expect(pickLatestPlanName(["plan.json", "plan-20260423-120000.json"])).toBe(
      "plan-20260423-120000.json",
    );
  });
});

describe("pickLatestWriteupName", () => {
  it("picks the lexicographically greatest writeup-<paperId>-*.md", () => {
    const picked = pickLatestWriteupName(
      [
        "writeup-paper-1-20260101-0000.md",
        "writeup-paper-1-20260423-1430.md",
        "writeup-paper-2-20260423-1430.md",
        "plan-20260423-1430.json",
      ],
      "paper-1",
    );
    expect(picked).toBe("writeup-paper-1-20260423-1430.md");
  });

  it("falls back to bare writeup-<paperId>.md when no timestamped match", () => {
    expect(pickLatestWriteupName(["writeup-paper-1.md", "writeup-paper-2.md"], "paper-1")).toBe(
      "writeup-paper-1.md",
    );
  });

  it("never accepts a bare writeup.md (paperId is unknown)", () => {
    expect(pickLatestWriteupName(["writeup.md"], "paper-1")).toBeNull();
  });

  it("returns null when no matching writeup is present", () => {
    expect(pickLatestWriteupName(["plan-20260423-1430.json"], "paper-1")).toBeNull();
  });
});
