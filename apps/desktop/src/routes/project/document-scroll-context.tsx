import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// Lifts each surface's `DocumentView` scroll API into a context so sibling
// columns (the margin gutter and the marks list) can align to the document
// without being rendered inside its scroll container. PdfPane / MdReviewSurface
// / HtmlReviewSurface call `useRegisterDocumentScroll` to publish; consumers
// call `useDocumentScroll`. When no paper is open the value stays empty.
export interface DocumentScrollState {
  scrollContainer: HTMLElement | null;
  annotationTops: ReadonlyMap<string, number>;
  scrollToAnnotation: (id: string) => void;
}

const EMPTY_TOPS: ReadonlyMap<string, number> = new Map();
const NOOP_SCROLL: (id: string) => void = () => {};

const EMPTY_STATE: DocumentScrollState = {
  scrollContainer: null,
  annotationTops: EMPTY_TOPS,
  scrollToAnnotation: NOOP_SCROLL,
};

interface ContextValue {
  state: DocumentScrollState;
  set: (next: DocumentScrollState | null) => void;
}

const Ctx = createContext<ContextValue | null>(null);

export function DocumentScrollProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<DocumentScrollState>(EMPTY_STATE);
  const set = useCallback((next: DocumentScrollState | null): void => {
    setState(next ?? EMPTY_STATE);
  }, []);
  const value = useMemo<ContextValue>(() => ({ state, set }), [state, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDocumentScroll(): DocumentScrollState {
  const ctx = useContext(Ctx);
  return ctx ? ctx.state : EMPTY_STATE;
}

// Surfaces (PdfPane / MdReviewSurface / HtmlReviewSurface) call this to
// publish their current scroll API. Update on every dep change; clear only
// on unmount so paper-to-paper churn doesn't blink the empty state in
// between renders.
export function useRegisterDocumentScroll(
  scrollContainer: HTMLElement | null,
  annotationTops: ReadonlyMap<string, number>,
  scrollToAnnotation: (id: string) => void,
): void {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (!ctx) return;
    ctx.set({ scrollContainer, annotationTops, scrollToAnnotation });
  }, [ctx, scrollContainer, annotationTops, scrollToAnnotation]);
  useEffect(() => {
    return () => ctx?.set(null);
  }, [ctx]);
}
