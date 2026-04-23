import type { ProjectFileFormat } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import { selectSiblingSourceCandidates } from "../build-bundle";

// Minimal shape the selector needs from a ProjectFileRow; the full row has
// more columns we don't exercise here.
type FileShape = { relPath: string; format: ProjectFileFormat };

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
