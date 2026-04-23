import type { ProjectFileRow } from "@obelus/repo";
import type { JSX, KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fuzzyMatch } from "../../lib/fuzzy";
import { emitOpenFile } from "../../lib/open-file-event";
import { useProject } from "./context";
import { useQuickOpenStore } from "./quick-open-store-context";

const MAX_RESULTS = 50;

interface Result {
  row: ProjectFileRow;
  indices: readonly number[];
  score: number;
}

export default function QuickOpenPalette(): JSX.Element | null {
  const { project, repo } = useProject();
  const store = useQuickOpenStore();
  const isOpen = store((s) => s.isOpen);
  const query = store((s) => s.query);
  const selectedIndex = store((s) => s.selectedIndex);

  const [files, setFiles] = useState<ReadonlyArray<ProjectFileRow>>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    void repo.projectFiles
      .listForProject(project.id)
      .then((rows) => {
        if (!cancelled) setFiles(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[quick-open] list project files failed", err);
        setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, project.id, repo]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (ev: MouseEvent): void => {
      const target = ev.target as Node | null;
      if (target && panelRef.current && !panelRef.current.contains(target)) {
        store.getState().close();
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [isOpen, store]);

  const results = useMemo<Result[]>(() => {
    if (!isOpen) return [];
    const trimmed = query.trim();
    if (trimmed === "") {
      return files.slice(0, MAX_RESULTS).map((row) => ({ row, indices: [], score: 0 }));
    }
    const hits: Result[] = [];
    for (const row of files) {
      const m = fuzzyMatch(trimmed, row.relPath);
      if (m !== null) hits.push({ row, indices: m.indices, score: m.score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, MAX_RESULTS);
  }, [files, query, isOpen]);

  if (!isOpen) return null;

  const pick = (row: ProjectFileRow): void => {
    emitOpenFile({ projectId: project.id, relPath: row.relPath });
    store.getState().close();
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (results.length === 0) return;
      const next = Math.min(selectedIndex + 1, results.length - 1);
      store.getState().setSelectedIndex(next);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (results.length === 0) return;
      const next = Math.max(selectedIndex - 1, 0);
      store.getState().setSelectedIndex(next);
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      const chosen = results[selectedIndex];
      if (chosen) pick(chosen.row);
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      store.getState().close();
    }
  };

  const clampedIndex = Math.min(selectedIndex, Math.max(results.length - 1, 0));
  const activeDescendant = results[clampedIndex] ? `${listboxId}-item-${clampedIndex}` : undefined;

  return (
    <div ref={panelRef} className="quick-open">
      <input
        ref={inputRef}
        className="quick-open__input"
        type="text"
        role="combobox"
        placeholder="Open file…"
        value={query}
        spellCheck={false}
        autoComplete="off"
        aria-label="Open file"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        aria-haspopup="listbox"
        onChange={(e) => store.getState().setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="quick-open__list" role="listbox" id={listboxId}>
        {loading && results.length === 0 ? (
          <div className="quick-open__empty">Loading…</div>
        ) : results.length === 0 ? (
          <div className="quick-open__empty">
            {files.length === 0 ? "No files scanned yet." : "No files match."}
          </div>
        ) : (
          results.map((r, i) => (
            <button
              key={r.row.relPath}
              type="button"
              id={`${listboxId}-item-${i}`}
              className={
                i === clampedIndex
                  ? "quick-open__item quick-open__item--active"
                  : "quick-open__item"
              }
              role="option"
              aria-selected={i === clampedIndex}
              onMouseEnter={() => store.getState().setSelectedIndex(i)}
              onClick={() => pick(r.row)}
            >
              <FilePathView relPath={r.row.relPath} indices={r.indices} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function FilePathView({
  relPath,
  indices,
}: {
  relPath: string;
  indices: readonly number[];
}): JSX.Element {
  const slash = relPath.lastIndexOf("/");
  const dir = slash >= 0 ? relPath.slice(0, slash + 1) : "";
  const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  const dirLen = dir.length;
  return (
    <>
      <span className="quick-open__name">{highlight(name, indices, dirLen)}</span>
      {dir.length > 0 && <span className="quick-open__dir">{highlight(dir, indices, 0)}</span>}
    </>
  );
}

function highlight(
  text: string,
  absoluteIndices: readonly number[],
  offset: number,
): ReactFragment {
  if (absoluteIndices.length === 0) return text;
  const end = offset + text.length;
  const local: number[] = [];
  for (const i of absoluteIndices) {
    if (i >= offset && i < end) local.push(i - offset);
  }
  if (local.length === 0) return text;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  for (const i of local) {
    if (i > cursor) parts.push(<span key={`t${cursor}`}>{text.slice(cursor, i)}</span>);
    parts.push(
      <span key={`m${i}`} className="quick-open__match">
        {text[i]}
      </span>,
    );
    cursor = i + 1;
  }
  if (cursor < text.length) {
    parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}

type ReactFragment = JSX.Element | string;
