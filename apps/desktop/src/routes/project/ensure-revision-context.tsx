import type { JSX, ReactNode } from "react";
import { createContext, useContext } from "react";

// Seam for the writer-mode MD/HTML first-mark flow and the notes-only
// Start-review flow. When no paper row yet exists for the open file, callers
// pull this callback from context and invoke it to materialize a paper +
// revision on demand. Both ids come back so callers (StartReviewButton) can
// use the paperId immediately without waiting for the OpenPaper effect to
// settle after `refreshOpenPaper()`.
//
// Writer-mode MD/HTML sets a real callback; reviewer-mode MD/HTML and PDFs
// leave it null (both materialize papers eagerly in `OpenPaper`).
type EnsureRevision = () => Promise<{ paperId: string; revisionId: string }>;

const EnsureRevisionContext = createContext<EnsureRevision | null>(null);

interface ProviderProps {
  value: EnsureRevision | null;
  children: ReactNode;
}

export function EnsureRevisionProvider({ value, children }: ProviderProps): JSX.Element {
  return <EnsureRevisionContext.Provider value={value}>{children}</EnsureRevisionContext.Provider>;
}

export function useEnsureRevision(): EnsureRevision | null {
  return useContext(EnsureRevisionContext);
}
