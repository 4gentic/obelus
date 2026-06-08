import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PageNavProvider } from "./page-nav";

type Props = {
  provider: PageNavProvider;
  /** Host chrome class so the desktop toolbar and web breadcrumb can size it. */
  className?: string;
};

// "current / total" with an always-editable current. The displayed value tracks
// the live page as the user scrolls until the user types; the draft then holds
// the keystrokes so a scroll tick can't clobber what's being typed. Enter or
// click-away commits via goTo (which clamps); Escape abandons.
//
// `commit` reads the draft from a ref, not state: Enter and Escape call
// `input.blur()`, which fires `onBlur` synchronously — before the matching
// `setDraft` has flushed. A state-closure read would see the pre-blur value, so
// Escape would navigate instead of abandoning. The ref is the single source of
// truth for commit; Escape clears it first so its own blur-commit is a no-op.
export default function PageNavField({ provider, className }: Props): JSX.Element {
  const current = useSyncExternalStore(provider.subscribe, provider.current, provider.current);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const value = draft ?? String(current);

  const setDraftValue = useCallback((next: string | null): void => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const commit = useCallback((): void => {
    const pending = draftRef.current;
    if (pending !== null) {
      const next = Number.parseInt(pending, 10);
      if (Number.isFinite(next)) provider.goTo(next);
    }
    setDraftValue(null);
  }, [provider, setDraftValue]);

  const onKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLInputElement>): void => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
        inputRef.current?.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        setDraftValue(null);
        inputRef.current?.blur();
      }
    },
    [commit, setDraftValue],
  );

  return (
    <div className={className ? `pagenav ${className}` : "pagenav"}>
      <input
        ref={inputRef}
        className="pagenav__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`Page ${current} of ${provider.count}`}
        value={value}
        onChange={(e) => setDraftValue(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="pagenav__total" aria-hidden="true">{` / ${provider.count}`}</span>
    </div>
  );
}
