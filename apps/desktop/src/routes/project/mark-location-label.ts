import type { AnnotationRow } from "@obelus/repo";

// Render a mark's location chip. PDF anchors → "p. N"; source anchors → a
// line range; html anchors → source-hint line range when paired, else char
// offset range. Switches on the anchor's discriminant.
export function markLocationLabel(a: AnnotationRow): string {
  if (a.anchor.kind === "source") {
    const { lineStart, lineEnd } = a.anchor;
    return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
  }
  if (a.anchor.kind === "html") {
    if (a.anchor.sourceHint) {
      const { lineStart, lineEnd } = a.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    const { charOffsetStart, charOffsetEnd } = a.anchor;
    return `c${charOffsetStart}–${charOffsetEnd}`;
  }
  if (a.anchor.kind === "html-element") {
    if (a.anchor.sourceHint) {
      const { lineStart, lineEnd } = a.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    return a.anchor.file;
  }
  return `p. ${a.anchor.page}`;
}
