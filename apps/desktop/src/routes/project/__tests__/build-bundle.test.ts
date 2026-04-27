import type {
  AnnotationRow,
  PaperRow,
  ProjectFileFormat,
  ProjectFileRow,
  ProjectRow,
  Repository,
  RevisionRow,
} from "@obelus/repo";
import { describe, expect, it } from "vitest";
import {
  chooseSourceRoot,
  exportHtmlBundleForPaper,
  exportMdBundleForPaper,
  scopePaperFiles,
  selectSiblingSourceCandidates,
} from "../build-bundle";

// Minimal shape the selector needs from a ProjectFileRow; the full row has
// more columns we don't exercise here.
type FileShape = { relPath: string; format: ProjectFileFormat };
type InventoryShape = Pick<ProjectFileRow, "relPath" | "format" | "role">;

describe("selectSiblingSourceCandidates", () => {
  it("picks .typ files in the same directory as the PDF", () => {
    // Real shape from negotiated_autonomy: PDF at paper/short/main.pdf with
    // the paper split across `paper/short/*.typ` includes.
    const files: FileShape[] = [
      { relPath: "paper/main.typ", format: "typ" },
      { relPath: "paper/sections/01-introduction.typ", format: "typ" },
      { relPath: "paper/short/main.typ", format: "typ" },
      { relPath: "paper/short/00-abstract.typ", format: "typ" },
      { relPath: "paper/short/01-introduction.typ", format: "typ" },
      { relPath: "paper/short/figures/caption.typ", format: "typ" },
      { relPath: "paper/short/main.pdf", format: "pdf" },
      { relPath: "CLAUDE.md", format: "md" },
    ];

    const picks = selectSiblingSourceCandidates(files, "paper/short/main.pdf", undefined);

    expect(picks).toEqual([
      "paper/short/main.typ",
      "paper/short/00-abstract.typ",
      "paper/short/01-introduction.typ",
    ]);
  });

  it("excludes the file already covered by mainRelPath", () => {
    const files: FileShape[] = [
      { relPath: "paper/short/main.typ", format: "typ" },
      { relPath: "paper/short/00-abstract.typ", format: "typ" },
    ];

    const picks = selectSiblingSourceCandidates(
      files,
      "paper/short/main.pdf",
      "paper/short/main.typ",
    );

    expect(picks).toEqual(["paper/short/00-abstract.typ"]);
  });

  it("handles a flat project (PDF at the project root)", () => {
    const files: FileShape[] = [
      { relPath: "main.tex", format: "tex" },
      { relPath: "refs.bib", format: "bib" },
      { relPath: "paper.pdf", format: "pdf" },
      { relPath: "sub/notes.md", format: "md" },
    ];

    const picks = selectSiblingSourceCandidates(files, "paper.pdf", undefined);

    expect(picks).toEqual(["main.tex"]);
  });

  it("accepts .tex and .md alongside .typ; rejects other formats", () => {
    const files: FileShape[] = [
      { relPath: "paper/a.typ", format: "typ" },
      { relPath: "paper/b.tex", format: "tex" },
      { relPath: "paper/c.md", format: "md" },
      { relPath: "paper/d.bib", format: "bib" },
      { relPath: "paper/e.json", format: "json" },
    ];

    const picks = selectSiblingSourceCandidates(files, "paper/x.pdf", undefined);

    expect(picks).toEqual(["paper/a.typ", "paper/b.tex", "paper/c.md"]);
  });

  it("returns empty when nothing sits next to the PDF", () => {
    const files: FileShape[] = [
      { relPath: "src/a.typ", format: "typ" },
      { relPath: "notes/b.md", format: "md" },
    ];

    const picks = selectSiblingSourceCandidates(files, "other/paper.pdf", undefined);

    expect(picks).toEqual([]);
  });
});

describe("scopePaperFiles", () => {
  it("drops files outside the paper's directory tree", () => {
    // Real shape from negotiated_autonomy: hundreds of unrelated JSON
    // fixtures, plus root-level docs, plus the actual paper at paper/short/.
    // Only the paper's source files should survive.
    const files: InventoryShape[] = [
      { relPath: "CLAUDE.md", format: "md", role: null },
      { relPath: "ROADMAP.md", format: "md", role: null },
      { relPath: "integrations/ai-foundation/PRs/001-foo.md", format: "md", role: null },
      { relPath: "runtime/benchmarks/results/foo.json", format: "json", role: null },
      { relPath: "paper/short/main.typ", format: "typ", role: null },
      { relPath: "paper/short/00-abstract.typ", format: "typ", role: null },
      { relPath: "paper/short/09-conclusion.typ", format: "typ", role: null },
      { relPath: "paper/short/main.pdf", format: "pdf", role: null },
      { relPath: "paper/notes/literature/extra.md", format: "md", role: null },
    ];

    const scoped = scopePaperFiles(files, "paper/short", "paper/short/main.typ");

    expect(scoped.map((f) => f.relPath)).toEqual([
      "paper/short/main.typ",
      "paper/short/00-abstract.typ",
      "paper/short/09-conclusion.typ",
    ]);
  });

  it("drops non-source formats inside the paper directory", () => {
    // Even files inside the paper's directory only survive if their format
    // is a source format the planner can read.
    const files: InventoryShape[] = [
      { relPath: "paper/short/main.typ", format: "typ", role: null },
      { relPath: "paper/short/data.json", format: "json", role: null },
      { relPath: "paper/short/notes.txt", format: "txt", role: null },
      { relPath: "paper/short/refs.bib", format: "bib", role: null },
    ];

    const scoped = scopePaperFiles(files, "paper/short", "paper/short/main.typ");

    expect(scoped.map((f) => f.relPath)).toEqual(["paper/short/main.typ", "paper/short/refs.bib"]);
  });

  it("retains the entrypoint even when its dirname is empty (paper at project root)", () => {
    const files: InventoryShape[] = [
      { relPath: "paper.tex", format: "tex", role: null },
      { relPath: "intro.tex", format: "tex", role: null },
      { relPath: "deep/nested/file.tex", format: "tex", role: null },
      { relPath: "junk/other.json", format: "json", role: null },
    ];

    // root === "" means "no narrowing" — extension-only filter falls through.
    const scoped = scopePaperFiles(files, "", "paper.tex");

    expect(scoped.map((f) => f.relPath)).toEqual([
      "paper.tex",
      "intro.tex",
      "deep/nested/file.tex",
    ]);
  });

  it("does not match a file whose path starts with the root as a substring", () => {
    // `paper/short` should not match `paper/shorter/foo.typ` — guard against
    // the naive `startsWith(root)` bug.
    const files: InventoryShape[] = [
      { relPath: "paper/short/main.typ", format: "typ", role: null },
      { relPath: "paper/shorter/foo.typ", format: "typ", role: null },
      { relPath: "paper/short", format: "typ", role: null },
    ];

    const scoped = scopePaperFiles(files, "paper/short", "paper/short/main.typ");

    expect(scoped.map((f) => f.relPath).sort()).toEqual(["paper/short", "paper/short/main.typ"]);
  });

  it("preserves the role field when present", () => {
    const files: InventoryShape[] = [
      { relPath: "paper/short/main.typ", format: "typ", role: "main" },
      { relPath: "paper/short/01-intro.typ", format: "typ", role: null },
    ];

    const scoped = scopePaperFiles(files, "paper/short", "paper/short/main.typ");

    expect(scoped).toEqual([
      { relPath: "paper/short/main.typ", format: "typ", role: "main" },
      { relPath: "paper/short/01-intro.typ", format: "typ", role: null },
    ]);
  });
});

describe("chooseSourceRoot", () => {
  it("returns PDF dirname when mainRelPath is in a different tree", () => {
    // The live regression: a stale scan pinned `mainRelPath` at
    // `runtime/ARCHITECTURE.md` while the PDF lives in `paper/short`. The
    // chooser must ignore the misidentified entrypoint and trust the PDF.
    expect(chooseSourceRoot("runtime/ARCHITECTURE.md", "paper/short/main.pdf")).toBe("paper/short");
  });

  it("returns PDF dirname when mainRelPath is undefined", () => {
    expect(chooseSourceRoot(undefined, "paper/short/main.pdf")).toBe("paper/short");
  });

  it("returns PDF dirname when mainRelPath is a sibling of the PDF", () => {
    expect(chooseSourceRoot("paper/short/main.typ", "paper/short/main.pdf")).toBe("paper/short");
  });

  it("returns PDF dirname for a flat layout where both sit at the project root", () => {
    expect(chooseSourceRoot("main.tex", "paper.pdf")).toBe("");
  });

  it("returns PDF dirname when mainRelPath is a descendant of the PDF dirname", () => {
    // Split-source layout: source under `paper/short/sections/` while the
    // PDF lives at `paper/short/main.pdf`. The PDF dirname is still the
    // anchor; the entrypoint may sit deeper without dragging the scope down.
    expect(chooseSourceRoot("paper/short/sections/01-intro.typ", "paper/short/main.pdf")).toBe(
      "paper/short",
    );
  });
});

describe("entrypoint scoping (regression for runtime/ARCHITECTURE.md leak)", () => {
  // Mirrors the inline logic in `exportBundleForPaper` so the regression
  // tests exercise both halves of the fix (chooser + entrypoint hand-off)
  // as a single behaviour.
  function pickScopedEntrypoint(mainRelPath: string | undefined, root: string): string | undefined {
    if (mainRelPath === undefined) return undefined;
    if (root === "") return mainRelPath;
    if (mainRelPath === root) return mainRelPath;
    if (mainRelPath.startsWith(`${root}/`)) return mainRelPath;
    return undefined;
  }

  it("scopePaperFiles drops out-of-tree entrypoint when scopedEntrypoint is undefined", () => {
    // Reproduces the bug: an out-of-tree mainRelPath used to slip past the
    // INVENTORY_FORMATS filter via scopePaperFiles's entrypoint exception.
    // With the chooser collapsing scopedEntrypoint to undefined for an
    // out-of-tree main, the file must not survive scoping.
    const files: InventoryShape[] = [
      { relPath: "runtime/ARCHITECTURE.md", format: "md", role: null },
      { relPath: "paper/short/main.typ", format: "typ", role: null },
      { relPath: "paper/short/main.pdf", format: "pdf", role: null },
    ];

    const root = chooseSourceRoot("runtime/ARCHITECTURE.md", "paper/short/main.pdf");
    const scopedEntrypoint = pickScopedEntrypoint("runtime/ARCHITECTURE.md", root);

    expect(root).toBe("paper/short");
    expect(scopedEntrypoint).toBeUndefined();

    const scoped = scopePaperFiles(files, root, scopedEntrypoint);
    expect(scoped.map((f) => f.relPath)).toEqual(["paper/short/main.typ"]);
  });

  it("flat layout: both PDF and main at the project root, both source files included", () => {
    const files: InventoryShape[] = [
      { relPath: "main.tex", format: "tex", role: null },
      { relPath: "intro.tex", format: "tex", role: null },
      { relPath: "paper.pdf", format: "pdf", role: null },
      { relPath: "junk/other.json", format: "json", role: null },
    ];

    const root = chooseSourceRoot("main.tex", "paper.pdf");
    expect(root).toBe("");

    const scopedEntrypoint = pickScopedEntrypoint("main.tex", root);
    expect(scopedEntrypoint).toBe("main.tex");

    const scoped = scopePaperFiles(files, root, scopedEntrypoint);
    expect(scoped.map((f) => f.relPath)).toEqual(["main.tex", "intro.tex"]);
  });

  it("split-source layout: mainRelPath descendant of pdfRoot is preserved as scopedEntrypoint", () => {
    const files: InventoryShape[] = [
      { relPath: "paper/short/main.typ", format: "typ", role: "main" },
      { relPath: "paper/short/00-abstract.typ", format: "typ", role: null },
      { relPath: "paper/short/main.pdf", format: "pdf", role: null },
      { relPath: "runtime/ARCHITECTURE.md", format: "md", role: null },
    ];

    const root = chooseSourceRoot("paper/short/main.typ", "paper/short/main.pdf");
    expect(root).toBe("paper/short");

    const scopedEntrypoint = pickScopedEntrypoint("paper/short/main.typ", root);
    expect(scopedEntrypoint).toBe("paper/short/main.typ");

    const scoped = scopePaperFiles(files, root, scopedEntrypoint);
    expect(scoped.map((f) => f.relPath)).toEqual([
      "paper/short/main.typ",
      "paper/short/00-abstract.typ",
    ]);
  });
});

describe("exportMdBundleForPaper", () => {
  function makeRepo(fixture: {
    paper: PaperRow;
    project: ProjectRow;
    revisions: RevisionRow[];
    annotations: AnnotationRow[];
  }): Repository {
    // Minimal stub: the MD export path only reaches into these four repos.
    // Anything else is deliberately unstubbed so an accidental call surfaces
    // loudly rather than silently returning empty.
    const stub = {
      papers: {
        get: async (id: string) => (id === fixture.paper.id ? fixture.paper : undefined),
      },
      projects: {
        get: async (id: string) => (id === fixture.project.id ? fixture.project : undefined),
      },
      revisions: {
        listForPaper: async (paperId: string) =>
          fixture.revisions.filter((r) => r.paperId === paperId),
      },
      annotations: {
        listForRevision: async (revId: string) =>
          fixture.annotations.filter((a) => a.revisionId === revId),
      },
    };
    return stub as unknown as Repository;
  }

  it("emits a V2 bundle with entrypoint, no pdf block, and a source anchor", async () => {
    const paper: PaperRow = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Markdown Paper",
      createdAt: "2026-04-24T00:00:00.000Z",
      format: "md",
      pdfSha256: "deadbeef",
      projectId: "22222222-2222-4222-8222-222222222222",
      pdfRelPath: "paper.md",
      pageCount: 0,
    };
    const project: ProjectRow = {
      id: "22222222-2222-4222-8222-222222222222",
      label: "MD project",
      kind: "reviewer",
      root: "/tmp/mdproj",
      pinned: false,
      archived: false,
      lastOpenedAt: null,
      lastOpenedFilePath: null,
      createdAt: "2026-04-23T00:00:00.000Z",
      deskId: "33333333-3333-4333-8333-333333333333",
    };
    const revision: RevisionRow = {
      id: "44444444-4444-4444-8444-444444444444",
      paperId: paper.id,
      revisionNumber: 1,
      pdfSha256: paper.pdfSha256,
      createdAt: paper.createdAt,
    };
    const ann: AnnotationRow = {
      id: "55555555-5555-4555-8555-555555555555",
      revisionId: revision.id,
      category: "unclear",
      quote: "some quoted passage",
      contextBefore: "before ",
      contextAfter: " after",
      anchor: {
        kind: "source",
        file: "paper.md",
        lineStart: 3,
        colStart: 2,
        lineEnd: 3,
        colEnd: 21,
      },
      note: "needs clarification",
      thread: [],
      createdAt: paper.createdAt,
    };
    const repo = makeRepo({ paper, project, revisions: [revision], annotations: [ann] });

    const { json, annotationCount } = await exportMdBundleForPaper({
      repo,
      paperId: paper.id,
    });
    expect(annotationCount).toBe(1);

    const bundle = JSON.parse(json) as {
      papers: Array<{ entrypoint?: string; pdf?: unknown }>;
      annotations: Array<{ anchor: { kind: string } }>;
    };
    expect(bundle.papers).toHaveLength(1);
    const first = bundle.papers[0];
    if (!first) throw new Error("expected one paper");
    expect(first.entrypoint).toBe("paper.md");
    expect(first.pdf).toBeUndefined();
    const firstAnn = bundle.annotations[0];
    if (!firstAnn) throw new Error("expected one annotation");
    expect(firstAnn.anchor.kind).toBe("source");
  });

  it("drops annotations without a sourceAnchor", async () => {
    const paper: PaperRow = {
      id: "66666666-6666-4666-8666-666666666666",
      title: "Partial",
      createdAt: "2026-04-24T00:00:00.000Z",
      format: "md",
      pdfSha256: "feedbeef",
      projectId: "77777777-7777-4777-8777-777777777777",
      pdfRelPath: "paper.md",
      pageCount: 0,
    };
    const project: ProjectRow = {
      id: "77777777-7777-4777-8777-777777777777",
      label: "MD",
      kind: "reviewer",
      root: "/tmp/mdproj2",
      pinned: false,
      archived: false,
      lastOpenedAt: null,
      lastOpenedFilePath: null,
      createdAt: "2026-04-23T00:00:00.000Z",
      deskId: "33333333-3333-4333-8333-333333333333",
    };
    const revision: RevisionRow = {
      id: "88888888-8888-4888-8888-888888888888",
      paperId: paper.id,
      revisionNumber: 1,
      pdfSha256: paper.pdfSha256,
      createdAt: paper.createdAt,
    };
    const anchored: AnnotationRow = {
      id: "99999999-9999-4999-8999-999999999999",
      revisionId: revision.id,
      category: "unclear",
      quote: "q",
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "source",
        file: "paper.md",
        lineStart: 1,
        colStart: 0,
        lineEnd: 1,
        colEnd: 1,
      },
      note: "",
      thread: [],
      createdAt: paper.createdAt,
    };
    const dangling: AnnotationRow = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revisionId: revision.id,
      category: "unclear",
      quote: "q",
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "pdf",
        page: 1,
        bbox: [0, 0, 1, 1],
        textItemRange: { start: [0, 0], end: [0, 1] },
      },
      note: "",
      thread: [],
      createdAt: paper.createdAt,
    };
    const repo = makeRepo({
      paper,
      project,
      revisions: [revision],
      annotations: [anchored, dangling],
    });

    const { annotationCount } = await exportMdBundleForPaper({ repo, paperId: paper.id });
    expect(annotationCount).toBe(1);
  });
});

describe("exportHtmlBundleForPaper", () => {
  function makeRepo(fixture: {
    paper: PaperRow;
    project: ProjectRow;
    revisions: RevisionRow[];
    annotations: AnnotationRow[];
  }): Repository {
    const stub = {
      papers: {
        get: async (id: string) => (id === fixture.paper.id ? fixture.paper : undefined),
      },
      projects: {
        get: async (id: string) => (id === fixture.project.id ? fixture.project : undefined),
      },
      revisions: {
        listForPaper: async (paperId: string) =>
          fixture.revisions.filter((r) => r.paperId === paperId),
      },
      annotations: {
        listForRevision: async (revId: string) =>
          fixture.annotations.filter((a) => a.revisionId === revId),
      },
    };
    return stub as unknown as Repository;
  }

  function htmlFixture(): {
    paper: PaperRow;
    project: ProjectRow;
    revision: RevisionRow;
  } {
    const paper: PaperRow = {
      id: "b453fe72-0bdd-4396-b2b8-bd39bb23da37",
      title: "Diagram",
      createdAt: "2026-04-25T00:00:00.000Z",
      format: "html",
      pdfSha256: "deadbeef",
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      pdfRelPath: "diagram.html",
      pageCount: 0,
    };
    const project: ProjectRow = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      label: "negotiated_autonomy",
      kind: "reviewer",
      root: "/tmp/htmlproj",
      pinned: false,
      archived: false,
      lastOpenedAt: null,
      lastOpenedFilePath: null,
      createdAt: "2026-04-23T00:00:00.000Z",
      deskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    };
    const revision: RevisionRow = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      paperId: paper.id,
      revisionNumber: 1,
      pdfSha256: paper.pdfSha256,
      createdAt: paper.createdAt,
    };
    return { paper, project, revision };
  }

  function htmlTextAnn(revisionId: string, createdAt: string): AnnotationRow {
    return {
      id: "f1111111-1111-4111-8111-111111111111",
      revisionId,
      category: "rephrase",
      quote: "Trust Contract",
      contextBefore: "the title says ",
      contextAfter: " everywhere",
      anchor: {
        kind: "html",
        file: "diagram.html",
        xpath: "./body[1]/h1[1]/text()[1]",
        charOffsetStart: 2273,
        charOffsetEnd: 2287,
      },
      note: "change the title to Contract Deal",
      thread: [],
      createdAt,
    };
  }

  function htmlElementAnn(revisionId: string, createdAt: string): AnnotationRow {
    return {
      id: "f2222222-2222-4222-8222-222222222222",
      revisionId,
      category: "wrong",
      quote: "[image: test.png]",
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "html-element",
        file: "diagram.html",
        xpath: "./body[1]/figure[1]/img[1]",
      },
      note: "external test image",
      thread: [],
      createdAt,
    };
  }

  it("accepts html + html-element on the same paper (regression)", async () => {
    const { paper, project, revision } = htmlFixture();
    const repo = makeRepo({
      paper,
      project,
      revisions: [revision],
      annotations: [
        htmlTextAnn(revision.id, paper.createdAt),
        htmlElementAnn(revision.id, paper.createdAt),
      ],
    });

    const { json, annotationCount } = await exportHtmlBundleForPaper({
      repo,
      paperId: paper.id,
    });
    expect(annotationCount).toBe(2);

    const bundle = JSON.parse(json) as {
      papers: Array<{ entrypoint?: string }>;
      annotations: Array<{ anchor: { kind: string } }>;
    };
    const first = bundle.papers[0];
    if (!first) throw new Error("expected one paper");
    expect(first.entrypoint).toBe("diagram.html");
    const kinds = bundle.annotations.map((a) => a.anchor.kind).sort();
    expect(kinds).toEqual(["html", "html-element"]);
  });

  it("rejects source-mode mixed with html-mode anchors", async () => {
    const { paper, project, revision } = htmlFixture();
    const sourceAnn: AnnotationRow = {
      id: "f3333333-3333-4333-8333-333333333333",
      revisionId: revision.id,
      category: "unclear",
      quote: "paired text",
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "source",
        file: "diagram.md",
        lineStart: 4,
        colStart: 0,
        lineEnd: 4,
        colEnd: 11,
      },
      note: "",
      thread: [],
      createdAt: paper.createdAt,
    };
    const repo = makeRepo({
      paper,
      project,
      revisions: [revision],
      annotations: [sourceAnn, htmlTextAnn(revision.id, paper.createdAt)],
    });

    await expect(exportHtmlBundleForPaper({ repo, paperId: paper.id })).rejects.toThrow(
      /mixes source-mode and html-mode anchors/,
    );
  });

  it("accepts an html-element-only paper", async () => {
    const { paper, project, revision } = htmlFixture();
    const repo = makeRepo({
      paper,
      project,
      revisions: [revision],
      annotations: [htmlElementAnn(revision.id, paper.createdAt)],
    });

    const { json, annotationCount } = await exportHtmlBundleForPaper({
      repo,
      paperId: paper.id,
    });
    expect(annotationCount).toBe(1);

    const bundle = JSON.parse(json) as {
      papers: Array<{ entrypoint?: string }>;
      annotations: Array<{ anchor: { kind: string } }>;
    };
    const first = bundle.papers[0];
    if (!first) throw new Error("expected one paper");
    expect(first.entrypoint).toBe("diagram.html");
    const firstAnn = bundle.annotations[0];
    if (!firstAnn) throw new Error("expected one annotation");
    expect(firstAnn.anchor.kind).toBe("html-element");
  });
});
