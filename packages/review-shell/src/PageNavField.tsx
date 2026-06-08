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
// the live page as the user scrolls, except while the input is focused — then a
// local draft holds the keystrokes so a scroll tick can't clobber what's being
// typed. Enter or blur commits via goTo (which clamps); Escape abandons.
export default function PageNavField({ provider, className }: Props): JSX.Element {
  const current = useSyncExternalStore(provider.subscribe, provider.current, provider.current);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const value = draft ?? String(current);

  const commit = useCallback((): void => {
    if (draft !== null) {
      const next = Number.parseInt(draft, 10);
      if (Number.isFinite(next)) provider.goTo(next);
    }
    setDraft(null);
  }, [draft, provider]);

  const onKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLInputElement>): void => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
        inputRef.current?.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        setDraft(null);
        inputRef.current?.blur();
      }
    },
    [commit],
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
        onFocus={() => setDraft(String(current))}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="pagenav__total" aria-hidden="true">{` / ${provider.count}`}</span>
    </div>
  );
}
