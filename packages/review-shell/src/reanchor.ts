import type { AnchorFields } from "@obelus/repo";

// Optional in-document re-anchoring backend. Only the PDF surface implements it
// today — it holds the PDFDocumentProxy and can re-locate a quote's text-item
// range against the live page text; MD/HTML omit it. The marks-import flow
// reads this off the mounted DocumentView to rebuild anchors when an imported
// archive came from a drifted version of the document. `null` means the quote
// couldn't be found — the caller keeps the mark and flags it rather than
// misplacing the highlight.
export interface ReanchorTarget {
  readonly quote: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
  readonly anchor: AnchorFields;
}

export interface ReanchorProvider {
  reanchor(target: ReanchorTarget): Promise<AnchorFields | null>;
}
