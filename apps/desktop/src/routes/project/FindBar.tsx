import type { JSX, KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { useFindStore } from "./find-store-context";

export default function FindBar(): JSX.Element | null {
  const store = useFindStore();
  const isOpen = store((s) => s.isOpen);
  const query = store((s) => s.query);
  const status = store((s) => s.status);
  const matches = store((s) => s.matches);
  const currentIndex = store((s) => s.currentIndex);
  const caseSensitive = store((s) => s.caseSensitive);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const counter = ((): string => {
    if (status === "searching") return "…";
    if (query.length === 0) return "";
    if (matches.length === 0) return "0 / 0";
    return `${currentIndex + 1} / ${matches.length}`;
  })();

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (ev.shiftKey) store.getState().prev();
      else store.getState().next();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      store.getState().close();
    }
  };

  const disabled = matches.length === 0;

  return (
    <search className="find-bar" aria-label="Find in document">
      <input
        ref={inputRef}
        className="find-bar__input"
        type="search"
        placeholder="Find in document"
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => store.getState().setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="find-bar__count" aria-live="polite">
        {counter}
      </span>
      <label
        className="find-bar__case"
        title={caseSensitive ? "Case-sensitive" : "Case-insensitive"}
      >
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => store.getState().setCaseSensitive(e.target.checked)}
        />
        <span aria-hidden="true">Aa</span>
      </label>
      <button
        type="button"
        className="btn btn--subtle find-bar__nav"
        onClick={() => store.getState().prev()}
        disabled={disabled}
        aria-label="Previous match"
        title="Previous (Shift+Enter)"
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn--subtle find-bar__nav"
        onClick={() => store.getState().next()}
        disabled={disabled}
        aria-label="Next match"
        title="Next (Enter)"
      >
        ↓
      </button>
      <button
        type="button"
        className="btn btn--subtle find-bar__close"
        onClick={() => store.getState().close()}
        aria-label="Close find"
        title="Close (Esc)"
      >
        ×
      </button>
    </search>
  );
}
