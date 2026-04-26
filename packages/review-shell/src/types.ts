import type { ReactNode } from "react";
import type { FindProvider } from "./find";

// Adapter-facing contract. A DocumentView provides three things:
//   (1) a ReactNode the shell mounts inside its scroll container; this node
//       owns the paper content, the highlight overlay, and selection capture
//       (everything format-specific).
//   (2) annotationTops — a map of saved-annotation id → Y offset relative to
//       the shell's scroll container. Margin-note alignment reads this.
//   (3) scrollToAnnotation — imperative scroll so clicking a margin note
//       reveals the source line.
//
// `editable` is forward-looking: PDF always reports false; MD/HTML will flip
// true when WYSIWYG edits land. The shell currently reads it only to stamp a
// data attribute for future styling hooks.
//
// `find` is the optional in-document search backend. The host wires the
// returned provider to the shared find-store so a single FindBar drives
// search across PDF, MD, and HTML surfaces.
export interface DocumentView {
  readonly content: ReactNode;
  readonly annotationTops: ReadonlyMap<string, number>;
  readonly scrollToAnnotation: (annotationId: string) => void;
  readonly editable: boolean;
  readonly find?: FindProvider;
}
