import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { type DirEntry, fsReadDir } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import { isOpenable, NOISE_DIRS } from "./openable";

interface TreeState {
  expanded: Set<string>;
  entries: Map<string, DirEntry[]>;
  hasOpenable: Map<string, boolean>;
  walking: boolean;
}

function joinPath(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function isAllowedName(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (NOISE_DIRS.has(name)) return false;
  return true;
}

async function walkAndPrecompute(
  rootId: string,
): Promise<{ entries: Map<string, DirEntry[]>; hasOpenable: Map<string, boolean> }> {
  const entries = new Map<string, DirEntry[]>();
  const hasOpenable = new Map<string, boolean>();

  async function visit(dir: string, ancestors: string[]): Promise<void> {
    const raw = await fsReadDir(rootId, dir).catch(() => [] as DirEntry[]);
    const kept = raw.filter((e) => isAllowedName(e.name));
    entries.set(dir, sortEntries(kept));

    for (const child of kept) {
      if (child.kind === "file" && isOpenable(child.name)) {
        hasOpenable.set(dir, true);
        for (const a of ancestors) hasOpenable.set(a, true);
      }
    }
    for (const child of kept) {
      if (child.kind === "dir") {
        const childPath = joinPath(dir, child.name);
        await visit(childPath, [...ancestors, dir]);
      }
    }
  }

  await visit(".", []);
  return { entries, hasOpenable };
}

interface EntryRowProps {
  path: string;
  entry: DirEntry;
  depth: number;
  tree: TreeState;
  showAll: boolean;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function filterChildren(
  children: DirEntry[] | undefined,
  path: string,
  tree: TreeState,
  showAll: boolean,
): DirEntry[] {
  if (!children) return [];
  if (showAll) return children;
  return children.filter((e) => {
    if (e.kind === "file") return isOpenable(e.name);
    const childPath = joinPath(path, e.name);
    return tree.hasOpenable.get(childPath) === true;
  });
}

function EntryRow(props: EntryRowProps): JSX.Element {
  const { path, entry, depth, tree, showAll, onToggle, onOpenFile } = props;
  const { openFilePath } = useProject();
  const buffers = useBuffersStore();
  const dirty = buffers((s) => s.isDirty(path));
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (entry.kind === "dir") {
    const expanded = tree.expanded.has(path);
    const children = filterChildren(tree.entries.get(path), path, tree, showAll);
    return (
      <>
        <button
          type="button"
          className="files__row files__row--dir"
          style={indent}
          onClick={() => onToggle(path)}
        >
          <span className="files__caret" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="files__name">{entry.name}</span>
        </button>
        {expanded &&
          children.map((child) => (
            <EntryRow
              key={joinPath(path, child.name)}
              path={joinPath(path, child.name)}
              entry={child}
              depth={depth + 1}
              tree={tree}
              showAll={showAll}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
      </>
    );
  }
  const selected = openFilePath === path;
  return (
    <button
      type="button"
      className={`files__row files__row--file${selected ? " files__row--selected" : ""}`}
      style={indent}
      onClick={() => onOpenFile(path)}
    >
      <span className="files__caret" aria-hidden="true" />
      <span className="files__name">{entry.name}</span>
      {dirty && (
        <span className="files__dirty-dot" role="img" aria-label="unsaved changes">
          •
        </span>
      )}
    </button>
  );
}

export default function FilesColumn(): JSX.Element {
  const { rootId, setOpenFilePath } = useProject();
  const buffers = useBuffersStore();
  const [tree, setTree] = useState<TreeState>(() => ({
    expanded: new Set(),
    entries: new Map(),
    hasOpenable: new Map(),
    walking: true,
  }));
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { entries, hasOpenable } = await walkAndPrecompute(rootId);
        if (cancelled) return;
        setTree({
          expanded: new Set(["."]),
          entries,
          hasOpenable,
          walking: false,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not read folder.");
        setTree((prev) => ({ ...prev, walking: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  const loadDir = useCallback(
    async (path: string): Promise<void> => {
      try {
        const raw = await fsReadDir(rootId, path);
        const kept = raw.filter((e) => isAllowedName(e.name));
        setTree((prev) => {
          const nextEntries = new Map(prev.entries);
          nextEntries.set(path, sortEntries(kept));
          return { ...prev, entries: nextEntries };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read folder.");
      }
    },
    [rootId],
  );

  const toggle = useCallback(
    (path: string) => {
      setTree((prev) => {
        const expanded = new Set(prev.expanded);
        if (expanded.has(path)) {
          expanded.delete(path);
        } else {
          expanded.add(path);
          if (!prev.entries.has(path)) void loadDir(path);
        }
        return { ...prev, expanded };
      });
    },
    [loadDir],
  );

  const openFile = useCallback(
    (path: string) => {
      const proceed = buffers.getState().requestSwitch(path);
      if (proceed) setOpenFilePath(path);
    },
    [buffers, setOpenFilePath],
  );

  const root = filterChildren(tree.entries.get("."), ".", tree, showAll);

  return (
    <aside className="files">
      <div className="files__header">
        <span className="files__header-title">Files</span>
        <button
          type="button"
          className="files__toggle"
          onClick={() => setShowAll((v) => !v)}
          aria-pressed={showAll}
        >
          {showAll ? "focused" : "show all"}
        </button>
      </div>
      {error && <p className="files__error">{error}</p>}
      {tree.walking ? (
        <p className="files__hint">…</p>
      ) : (
        <div className="files__tree" role="tree">
          {root.map((entry) => (
            <EntryRow
              key={entry.name}
              path={entry.name}
              entry={entry}
              depth={0}
              tree={tree}
              showAll={showAll}
              onToggle={toggle}
              onOpenFile={openFile}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
