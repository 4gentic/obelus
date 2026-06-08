import type { ReanchorProvider } from "@obelus/review-shell";
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

// Lifts the active surface's re-anchoring capability into a context so the
// review actions panel can re-resolve imported marks against the open
// document without being rendered inside the surface. The PDF adapter
// publishes a provider; MD/HTML publish `undefined`, which correctly disables
// re-anchoring (those formats import by exact hash match only).
interface ContextValue {
  state: ReanchorProvider | undefined;
  set: (next: ReanchorProvider | undefined) => void;
}

const Ctx = createContext<ContextValue | null>(null);

export function ReanchorContextProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<ReanchorProvider | undefined>(undefined);
  // Identity bail: `useRegisterReanchor` re-publishes on every dep change of
  // the surface adapter. Without this, a redundant call with the same provider
  // ref still forces a re-render that chains into a loop (the value memo gets a
  // fresh ref each time, re-firing the consumer).
  const set = useCallback((next: ReanchorProvider | undefined): void => {
    setState((prev) => (prev === next ? prev : next));
  }, []);
  const value = useMemo<ContextValue>(() => ({ state, set }), [state, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReanchor(): ReanchorProvider | undefined {
  const ctx = useContext(Ctx);
  return ctx ? ctx.state : undefined;
}

// Surfaces call this to publish their re-anchor provider. `ctx` is read through
// a ref rather than as an effect dependency: the provider's value memo lists
// `state`, so `ctx` gets a new ref each time we call `ctx.set` — listing it
// would re-fire the effect on the change it just produced, looping forever.
export function useRegisterReanchor(provider: ReanchorProvider | undefined): void {
  const ctx = useContext(Ctx);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  useEffect(() => {
    ctxRef.current?.set(provider);
  }, [provider]);
  useEffect(() => {
    return () => ctxRef.current?.set(undefined);
  }, []);
}
