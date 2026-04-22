import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type DirEntry, fsReadDir } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import { extensionOf, isSource, NOISE_DIRS } from "./openable";
import { useProjectBuild } from "./use-project-build";

interface TreeState {
  expanded: Set<string>;
  entries: Map<string, DirEntry[]>;
  hasOpenable: Map<string, boolean>;
  walking: boolean;
}

interface PdfEntry {
  dir: string;
  name: string;
  path: string;
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
      if (child.kind === "file" && isSource(child.name)) {
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

function collectPdfs(entries: Map<string, DirEntry[]>): PdfEntry[] {
  const out: PdfEntry[] = [];
  for (const [dir, children] of entries) {
    for (const child of children) {
      if (child.kind === "file" && extensionOf(child.name) === "pdf") {
        out.push({ dir, name: child.name, path: joinPath(dir, child.name) });
      }
    }
  }
  out.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.dir.localeCompare(b.dir);
  });
  return out;
}

function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: ".", name: path };
  return { dir: path.slice(0, idx), name: path.slice(idx + 1) };
}

interface PinButtonProps {
  pinned: boolean;
  onToggle: () => void;
}

function PinButton({ pinned, onToggle }: PinButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="files__pin"
      data-pinned={pinned ? "true" : "false"}
      aria-label={pinned ? "unpin" : "pin"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      •
    </button>
  );
}

interface MainButtonProps {
  isMain: boolean;
  onToggle: () => void;
}

// Compileable-source extensions only. Bib / cls / sty are not candidates.
const MAIN_EXTS = new Set(["tex", "md", "typ"]);

function MainButton({ isMain, onToggle }: MainButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="files__main-star"
      data-main={isMain ? "true" : "false"}
      aria-label={isMain ? "main file (click to unpin)" : "set as main file"}
      title={isMain ? "Main file — click to unpin" : "Set as main file"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {isMain ? "★" : "☆"}
    </button>
  );
}

interface FlatRowProps {
  path: string;
  name: string;
  dir: string;
  pinned: boolean;
  selected: boolean;
  showUnpinText?: boolean;
  onOpen: (path: string) => void;
  onTogglePin: (path: string) => void;
}

function FlatRow(props: FlatRowProps): JSX.Element {
  const { path, name, dir, pinned, selected, showUnpinText, onOpen, onTogglePin } = props;
  const buffers = useBuffersStore();
  const dirty = buffers((s) => s.isDirty(path));
  return (
    <li className="files__flat-item">
      <div className={`files__row files__row--flat${selected ? " files__row--selected" : ""}`}>
        <PinButton pinned={pinned} onToggle={() => onTogglePin(path)} />
        {dirty && (
          <span className="files__dirty-dot" role="img" aria-label="unsaved changes">
            •
          </span>
        )}
        <button type="button" className="files__row-open" onClick={() => onOpen(path)} title={path}>
          <span className="files__name">{name}</span>
          {dir !== "." && <span className="files__path-hint">({dir})</span>}
        </button>
        {showUnpinText && (
          <button
            type="button"
            className="files__unpin-text"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin(path);
            }}
          >
            unpin
          </button>
        )}
      </div>
    </li>
  );
}

interface EntryRowProps {
  path: string;
  entry: DirEntry;
  depth: number;
  tree: TreeState;
  pinned: Set<string>;
  mainRelPath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onTogglePin: (path: string) => void;
  onToggleMain: (path: string) => void;
}

function filterChildren(
  children: DirEntry[] | undefined,
  path: string,
  tree: TreeState,
): DirEntry[] {
  if (!children) return [];
  return children.filter((e) => {
    if (e.kind === "file") return isSource(e.name);
    const childPath = joinPath(path, e.name);
    return tree.hasOpenable.get(childPath) === true;
  });
}

function EntryRow(props: EntryRowProps): JSX.Element {
  const {
    path,
    entry,
    depth,
    tree,
    pinned,
    mainRelPath,
    onToggle,
    onOpenFile,
    onTogglePin,
    onToggleMain,
  } = props;
  const { openFilePath } = useProject();
  const buffers = useBuffersStore();
  const dirty = buffers((s) => s.isDirty(path));
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (entry.kind === "dir") {
    const expanded = tree.expanded.has(path);
    const children = filterChildren(tree.entries.get(path), path, tree);
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
              pinned={pinned}
              mainRelPath={mainRelPath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onTogglePin={onTogglePin}
              onToggleMain={onToggleMain}
            />
          ))}
      </>
    );
  }
  const selected = openFilePath === path;
  const isPinned = pinned.has(path);
  const ext = extensionOf(entry.name);
  const mainCandidate = ext !== null && MAIN_EXTS.has(ext);
  const isMain = mainRelPath === path;
  return (
    <div
      className={`files__row files__row--file${selected ? " files__row--selected" : ""}`}
      style={indent}
    >
      <span className="files__caret" aria-hidden="true" />
      <PinButton pinned={isPinned} onToggle={() => onTogglePin(path)} />
      {mainCandidate && <MainButton isMain={isMain} onToggle={() => onToggleMain(path)} />}
      {dirty && (
        <span className="files__dirty-dot" role="img" aria-label="unsaved changes">
          •
        </span>
      )}
      <button
        type="button"
        className="files__row-open"
        onClick={() => onOpenFile(path)}
        title={path}
      >
        <span className="files__name">{entry.name}</span>
      </button>
    </div>
  );
}

export default function FilesColumn(): JSX.Element {
  const { project, rootId, repo, setOpenFilePath, openFilePath } = useProject();
  const buffers = useBuffersStore();
  const { build, setMain } = useProjectBuild(repo, project.id);

  const [tree, setTree] = useState<TreeState>(() => ({
    expanded: new Set(),
    entries: new Map(),
    hasOpenable: new Map(),
    walking: true,
  }));
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await repo.filePins.listForProject(project.id);
        if (cancelled) return;
        setPinned(new Set(rows.map((r) => r.relPath)));
      } catch {
        if (cancelled) return;
        setPinned(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, repo.filePins]);

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

  const toggleMain = useCallback(
    (path: string) => {
      const wasMain = build?.mainRelPath === path;
      void setMain(wasMain ? null : path, !wasMain);
    },
    [build?.mainRelPath, setMain],
  );

  const togglePin = useCallback(
    (path: string) => {
      setPinned((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      void (async () => {
        try {
          const already = await repo.filePins.isPinned(project.id, path);
          if (already) await repo.filePins.unpin(project.id, path);
          else await repo.filePins.pin(project.id, path);
        } catch {
          try {
            const rows = await repo.filePins.listForProject(project.id);
            setPinned(new Set(rows.map((r) => r.relPath)));
          } catch {
            // ignore
          }
        }
      })();
    },
    [project.id, repo.filePins],
  );

  const pdfs = useMemo(() => collectPdfs(tree.entries), [tree.entries]);
  const pinnedList = useMemo(
    () =>
      Array.from(pinned).sort((a, b) => {
        const sa = splitPath(a);
        const sb = splitPath(b);
        const byName = sa.name.localeCompare(sb.name);
        if (byName !== 0) return byName;
        return sa.dir.localeCompare(sb.dir);
      }),
    [pinned],
  );

  const root = filterChildren(tree.entries.get("."), ".", tree);

  return (
    <aside className="files">
      {error && <p className="files__error">{error}</p>}

      {pinned.size > 0 && (
        <section className="files__section files__section--pinned">
          <div className="files__section-header">
            <span className="files__header-title">
              Pinned <span className="files__count">({pinned.size})</span>
            </span>
          </div>
          <ul className="files__flat">
            {pinnedList.map((path) => {
              const { dir, name } = splitPath(path);
              return (
                <FlatRow
                  key={`pin:${path}`}
                  path={path}
                  name={name}
                  dir={dir}
                  pinned={true}
                  selected={openFilePath === path}
                  showUnpinText={true}
                  onOpen={openFile}
                  onTogglePin={togglePin}
                />
              );
            })}
          </ul>
        </section>
      )}

      <section className="files__section files__section--review">
        <div className="files__section-header">
          <span className="files__header-title">
            To review <span className="files__count">({pdfs.length})</span>
          </span>
        </div>
        {tree.walking ? (
          <p className="files__hint">…</p>
        ) : pdfs.length === 0 ? (
          <p className="files__hint files__hint--empty">No PDFs here yet.</p>
        ) : (
          <ul className="files__flat">
            {pdfs.map((pdf) => (
              <FlatRow
                key={`pdf:${pdf.path}`}
                path={pdf.path}
                name={pdf.name}
                dir={pdf.dir}
                pinned={pinned.has(pdf.path)}
                selected={openFilePath === pdf.path}
                onOpen={openFile}
                onTogglePin={togglePin}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="files__section files__section--workspace">
        <div className="files__section-header">
          <span className="files__header-title">Workspace</span>
        </div>
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
                pinned={pinned}
                mainRelPath={build?.mainRelPath ?? null}
                onToggle={toggle}
                onOpenFile={openFile}
                onTogglePin={togglePin}
                onToggleMain={toggleMain}
              />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
