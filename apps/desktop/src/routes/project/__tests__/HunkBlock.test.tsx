// @vitest-environment happy-dom
import type { DiffHunkRow } from "@obelus/repo";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HunkBlock from "../HunkBlock";

type Props = Parameters<typeof HunkBlock>[0];

function hunk(overrides: Partial<DiffHunkRow> & Pick<DiffHunkRow, "id">): DiffHunkRow {
  return {
    sessionId: "sess-1",
    annotationIds: [overrides.id],
    file: "main.tex",
    category: null,
    patch: "@@ -1 +1 @@\n-old line\n+new line\n",
    modifiedPatchText: null,
    state: "pending",
    ambiguous: false,
    emptyReason: null,
    noteText: "",
    reviewerNotes: "",
    ordinal: 0,
    applyFailure: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    hunk: hunk({ id: "h1" }),
    indexInFile: 0,
    totalInFile: 3,
    markLocation: "main.tex:12",
    sourceText: "old line\n",
    hasSources: true,
    focused: false,
    editing: false,
    editingText: "",
    noting: false,
    noteText: "",
    marksByAnnotationId: new Map<string, string>(),
    onFocus: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onStartEdit: vi.fn(),
    onEditChange: vi.fn(),
    onCommitEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartNote: vi.fn(),
    onNoteChange: vi.fn(),
    onCommitNote: vi.fn(),
    onCancelNote: vi.fn(),
    ...overrides,
  };
}

function render(props: Props): HTMLDivElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<HunkBlock {...props} />);
  return host;
}

describe("HunkBlock — state classes", () => {
  it("applies the accepted class for an accepted hunk", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", state: "accepted" }) }));
    expect(host.querySelector(".hunk-block--accepted")).not.toBeNull();
    expect(host.querySelector(".hunk-block--rejected")).toBeNull();
  });

  it("applies the rejected class for a rejected hunk", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", state: "rejected" }) }));
    expect(host.querySelector(".hunk-block--rejected")).not.toBeNull();
  });

  it("applies the modified class for a modified hunk", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", state: "modified" }) }));
    expect(host.querySelector(".hunk-block--modified")).not.toBeNull();
  });

  it("carries no state modifier for a pending hunk", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", state: "pending" }) }));
    expect(host.querySelector(".hunk-block--accepted")).toBeNull();
    expect(host.querySelector(".hunk-block--rejected")).toBeNull();
    expect(host.querySelector(".hunk-block--modified")).toBeNull();
    // The state label still shows the raw state.
    expect(host.querySelector(".hunk-block__state")?.textContent).toBe("pending");
  });

  it("applies the focused class only when focused", () => {
    expect(render(baseProps({ focused: false })).querySelector(".hunk-block--focused")).toBeNull();
    expect(
      render(baseProps({ focused: true })).querySelector(".hunk-block--focused"),
    ).not.toBeNull();
  });
});

describe("HunkBlock — ambiguity tags", () => {
  it("shows the 'note' tag when ambiguous on a paper with no sources", () => {
    const host = render(
      baseProps({ hunk: hunk({ id: "h1", ambiguous: true }), hasSources: false }),
    );
    const tag = host.querySelector(".diff-block__tag");
    expect(tag?.textContent).toBe("note");
    expect(host.querySelector(".diff-block--ambiguous")).toBeNull();
  });

  it("shows the 'ambiguous' tag and modifier when ambiguous with sources", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", ambiguous: true }), hasSources: true }));
    expect(host.querySelector(".diff-block__tag")?.textContent).toBe("ambiguous");
    expect(host.querySelector(".diff-block--ambiguous")).not.toBeNull();
  });

  it("shows no ambiguity tag for an unambiguous hunk", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", ambiguous: false }) }));
    expect(host.querySelector(".diff-block__tag")).toBeNull();
  });
});

describe("HunkBlock — multi-mark", () => {
  it("renders the mark figure with a 'satisfies N marks' caption for a merged hunk", () => {
    const host = render(
      baseProps({
        hunk: hunk({ id: "h1", annotationIds: ["a1", "a2"] }),
        marksByAnnotationId: new Map([
          ["a1", "the first quoted passage"],
          ["a2", "the second quoted passage"],
        ]),
      }),
    );
    expect(host.querySelector(".hunk-block__mark")).not.toBeNull();
    expect(host.querySelector(".hunk-block__mark-count")?.textContent).toBe("satisfies 2 marks");
    expect(host.querySelectorAll(".hunk-block__mark-quote")).toHaveLength(2);
    // The marks fallback line is absent when quotes resolve.
    expect(host.querySelector(".hunk-block__follows")).toBeNull();
  });

  it("falls back to 'Follows from your marks' when no quotes resolve", () => {
    const host = render(
      baseProps({
        hunk: hunk({ id: "h1", annotationIds: ["a1", "a2"], category: "clarity" }),
        marksByAnnotationId: new Map<string, string>(),
      }),
    );
    expect(host.querySelector(".hunk-block__mark")).toBeNull();
    const follows = host.querySelector(".hunk-block__follows");
    expect(follows).not.toBeNull();
    expect(follows?.textContent).toContain("Follows from your marks");
    expect(follows?.textContent).toContain("clarity");
  });
});

describe("HunkBlock — empty patch", () => {
  it("renders the no-sources note for an empty patch on a paper with no sources", () => {
    const host = render(
      baseProps({
        hunk: hunk({ id: "h1", patch: "", ambiguous: true }),
        hasSources: false,
      }),
    );
    const empty = host.querySelector(".diff-block__empty");
    expect(empty?.textContent).toContain("Note only");
  });

  it("renders the flagged note for an empty patch when the paper has sources", () => {
    const host = render(
      baseProps({
        hunk: hunk({ id: "h1", patch: "", ambiguous: false }),
        hasSources: true,
      }),
    );
    const empty = host.querySelector(".diff-block__empty");
    expect(empty?.textContent).toContain("No edit");
  });

  it("renders the inline change for a non-empty patch", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1" }) }));
    expect(host.querySelector(".diff-block__change")).not.toBeNull();
    expect(host.querySelector(".diff-block__empty")).toBeNull();
  });
});

describe("HunkBlock — apply failure", () => {
  it("renders the apply-failure chip with its reason", () => {
    const host = render(
      baseProps({
        hunk: hunk({
          id: "h1",
          applyFailure: {
            reason: "no match in current source",
            attemptedAt: "2026-01-01T00:00:00",
          },
        }),
      }),
    );
    const chip = host.querySelector(".hunk-block__apply-failure");
    expect(chip).not.toBeNull();
    expect(host.querySelector(".hunk-block__apply-failure-reason")?.textContent).toBe(
      "no match in current source",
    );
  });

  it("renders no chip when there is no failure", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", applyFailure: null }) }));
    expect(host.querySelector(".hunk-block__apply-failure")).toBeNull();
  });
});

describe("HunkBlock — modes", () => {
  it("renders the editor with Save/Cancel in editing mode", () => {
    const host = render(baseProps({ editing: true, editingText: "edited prose" }));
    const textarea = host.querySelector<HTMLTextAreaElement>(".hunk-block__textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute("aria-label")).toBe("Edit the suggested text");
    const buttons = [...host.querySelectorAll(".hunk-block__edit .btn")].map((b) => b.textContent);
    expect(buttons).toEqual(["Cancel (Esc)", "Save (⌘↵)"]);
    // Default action buttons are not present in editing mode.
    expect(host.textContent).not.toContain("accept · a");
  });

  it("renders the note editor in noting mode", () => {
    const host = render(baseProps({ noting: true, noteText: "pushback" }));
    const textarea = host.querySelector<HTMLTextAreaElement>(".hunk-block__textarea");
    expect(textarea?.getAttribute("aria-label")).toBe("Comment for next pass");
    expect(host.textContent).not.toContain("accept · a");
  });

  it("renders the accept/reject/edit/note actions in the default mode", () => {
    const host = render(baseProps());
    const text = host.textContent ?? "";
    expect(text).toContain("accept · a");
    expect(text).toContain("reject · r");
    expect(text).toContain("edit · e");
    expect(text).toContain("note · n");
    expect(host.querySelector(".hunk-block__textarea")).toBeNull();
  });

  it("flags a stored note in the default mode", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", noteText: "a saved note" }) }));
    const flag = host.querySelector(".hunk-block__note-flag");
    expect(flag?.textContent).toBe("has note");
    expect(flag?.getAttribute("title")).toBe("a saved note");
  });

  it("shows no note flag when there is no stored note", () => {
    const host = render(baseProps({ hunk: hunk({ id: "h1", noteText: "" }) }));
    expect(host.querySelector(".hunk-block__note-flag")).toBeNull();
  });
});

describe("HunkBlock — header", () => {
  it("renders the index-of-total label and the category chip", () => {
    const host = render(
      baseProps({ hunk: hunk({ id: "h1", category: "clarity" }), indexInFile: 1, totalInFile: 4 }),
    );
    expect(host.querySelector(".hunk-block__ord")?.textContent).toBe("2/4");
    expect(host.querySelector(".diff-block__cat")?.textContent).toBe("clarity");
  });
});
