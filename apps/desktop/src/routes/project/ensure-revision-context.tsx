import type { JSX, ReactNode } from "react";
import { createContext, useContext } from "react";

// Seam for the writer-mode MD first-mark flow. When no paper row yet exists
// for the open file, the ReviewDraft save handler pulls this callback from
// context and hands it to `saveAnnotation({ …, ensureRevision })`. The review
// store invokes it to materialize a paper + revision on demand, then persists
// the mark against the freshly-created revision id.
//
// Writer-mode MD sets a real callback; reviewer-mode MD and PDFs leave it
// null (both materialize papers eagerly in `OpenPaper`).
type EnsureRevision = () => Promise<string>;

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
