import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  // Shallow-equality bail: `useRegisterDocumentScroll` calls `set` on every
  // dep change of the surface adapter. Without this guard, redundant calls
  // (same scrollContainer, same annotationTops Map, same scrollToAnnotation
  // ref) still produce a fresh state object and force a re-render, which
  // chains into a loop because the value memo (and therefore the consumer's
  // `ctx`) gets a new ref each time.
  const set = useCallback((next: DocumentScrollState | null): void => {
    setState((prev) => {
      const target = next ?? EMPTY_STATE;
      if (
        prev.scrollContainer === target.scrollContainer &&
        prev.annotationTops === target.annotationTops &&
        prev.scrollToAnnotation === target.scrollToAnnotation
      ) {
        return prev;
      }
      return target;
    });
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
//
// `ctx` is read through a ref rather than as an effect dependency: the
// provider's value memo has `state` in its dep list, so `ctx` gets a new
// ref every time we call `ctx.set` here. Listing it would re-fire the
// effect on the very state change it just produced, looping forever.
export function useRegisterDocumentScroll(
  scrollContainer: HTMLElement | null,
  annotationTops: ReadonlyMap<string, number>,
  scrollToAnnotation: (id: string) => void,
): void {
  const ctx = useContext(Ctx);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // biome-ignore lint/correctness/useExhaustiveDependencies: ctx is read via ref to avoid the loop described above.
  useEffect(() => {
    ctxRef.current?.set({ scrollContainer, annotationTops, scrollToAnnotation });
  }, [scrollContainer, annotationTops, scrollToAnnotation]);
  useEffect(() => {
    return () => ctxRef.current?.set(null);
  }, []);
}
