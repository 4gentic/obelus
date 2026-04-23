import type { PaperRow } from "@obelus/repo";
import type { DragEvent, JSX, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DirEntry, fsCreateFile, fsMovePath, fsReadDir } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import { extensionOf, isSource, NOISE_DIRS } from "./openable";
import { usePaperBuild } from "./use-paper-build";

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

const DRAG_MIME = "application/x-obelus-path";

function isSelfOrDescendant(target: string, source: string): boolean {
  if (target === source) return true;
  return target.startsWith(`${source}/`);
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

interface EntryRowCallbacks {
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onTogglePin: (path: string) => void;
  onToggleMain: (path: string) => void;
  onBeginCreate: (parentPath: string) => void;
  onMove: (fromPath: string, toParentDir: string) => void;
  renderCreateInput: (parentPath: string) => ReactNode;
}

interface EntryRowProps {
  path: string;
  entry: DirEntry;
  depth: number;
  tree: TreeState;
  pinned: Set<string>;
  mainRelPath: string | null;
  dragOverPath: string | null;
  setDragOverPath: (path: string | null) => void;
  callbacks: EntryRowCallbacks;
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

function onDragStartForPath(path: string): (event: DragEvent<HTMLElement>) => void {
  return (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, path);
    event.stopPropagation();
  };
}

function EntryRow(props: EntryRowProps): JSX.Element {
  const {
    path,
    entry,
    depth,
    tree,
    pinned,
    mainRelPath,
    dragOverPath,
    setDragOverPath,
    callbacks,
  } = props;
  const { openFilePath } = useProject();
  const buffers = useBuffersStore();
  const dirty = buffers((s) => s.isDirty(path));
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (entry.kind === "dir") {
    const expanded = tree.expanded.has(path);
    const children = filterChildren(tree.entries.get(path), path, tree);
    const isDropTarget = dragOverPath === path;
    const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOverPath(path);
    };
    const onDragOver = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    };
    const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
      if (event.currentTarget === event.target) setDragOverPath(null);
    };
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const from = event.dataTransfer.getData(DRAG_MIME);
      setDragOverPath(null);
      if (!from || isSelfOrDescendant(path, from)) return;
      callbacks.onMove(from, path);
    };
    return (
      <>
        <div
          role="treeitem"
          aria-expanded={expanded}
          tabIndex={-1}
          className={`files__row files__row--dir${isDropTarget ? " files__row--drop-target" : ""}`}
          style={indent}
          draggable={true}
          onDragStart={onDragStartForPath(path)}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <button
            type="button"
            className="files__row-toggle"
            onClick={() => callbacks.onToggle(path)}
          >
            <span className="files__caret" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
            <span className="files__name">{entry.name}</span>
          </button>
          <button
            type="button"
            className="files__row-new"
            aria-label={`New file in ${entry.name}`}
            title="New file in this folder"
            onClick={(event) => {
              event.stopPropagation();
              callbacks.onBeginCreate(path);
            }}
          >
            +
          </button>
        </div>
        {expanded && callbacks.renderCreateInput(path)}
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
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
              callbacks={callbacks}
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
      role="treeitem"
      tabIndex={-1}
      className={`files__row files__row--file${selected ? " files__row--selected" : ""}`}
      style={indent}
      draggable={true}
      onDragStart={onDragStartForPath(path)}
    >
      <span className="files__caret" aria-hidden="true" />
      <PinButton pinned={isPinned} onToggle={() => callbacks.onTogglePin(path)} />
      {mainCandidate ? (
        <MainButton isMain={isMain} onToggle={() => callbacks.onToggleMain(path)} />
      ) : (
        <span className="files__main-star-spacer" aria-hidden="true" />
      )}
      {dirty && (
        <span className="files__dirty-dot" role="img" aria-label="unsaved changes">
          •
        </span>
      )}
      <button
        type="button"
        className="files__row-open"
        onClick={() => callbacks.onOpenFile(path)}
        title={path}
      >
        <span className="files__name">{entry.name}</span>
      </button>
    </div>
  );
}

interface NewFileInputRowProps {
  parentPath: string;
  depth: number;
  name: string;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function NewFileInputRow(props: NewFileInputRowProps): JSX.Element {
  const { depth, name, error, inputRef, onChange, onCommit, onCancel } = props;
  const indent = { paddingLeft: `${depth * 12 + 8}px` };
  return (
    <div className="files__new-row" style={indent}>
      <span className="files__caret" aria-hidden="true" />
      <input
        ref={inputRef}
        className="files__new-input"
        type="text"
        placeholder="filename.tex"
        value={name}
        // biome-ignore lint/a11y/noAutofocus: mounted on demand by the user clicking "+"; focus is the whole point
        autoFocus
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {error && <span className="files__new-error">{error}</span>}
    </div>
  );
}

export default function FilesColumn(): JSX.Element {
  const { project, rootId, repo, setOpenFilePath, openFilePath } = useProject();
  const openPaper = useOpenPaper();
  const activePaperId = openPaper.kind === "ready" ? openPaper.paper.id : null;
  const buffers = useBuffersStore();
  const { build, setMain } = usePaperBuild(repo, activePaperId);
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [markCounts, setMarkCounts] = useState<Map<string, number>>(new Map());

  const reloadPapers = useCallback(async () => {
    const all = await repo.papers.list().catch(() => [] as PaperRow[]);
    const mine = all.filter((p) => p.projectId === project.id);
    setPapers(mine);
    // Lazily compute unresolved-mark counts per paper. Small N; single pass.
    const counts = new Map<string, number>();
    for (const p of mine) {
      try {
        const revs = await repo.revisions.listForPaper(p.id);
        const latest = revs[revs.length - 1];
        if (!latest) {
          counts.set(p.id, 0);
          continue;
        }
        const anns = await repo.annotations.listForRevision(latest.id);
        counts.set(p.id, anns.length);
      } catch (err) {
        console.warn("FilesColumn: mark count failed for paper", p.id, err);
        counts.set(p.id, 0);
      }
    }
    setMarkCounts(counts);
  }, [repo, project.id]);

  useEffect(() => {
    void reloadPapers();
  }, [reloadPapers]);

  // When the open paper changes, its mark count may have moved too; refresh
  // cheaply. The full reload is fine for the small N of papers per project.
  useEffect(() => {
    if (openPaper.kind === "ready") void reloadPapers();
  }, [openPaper.kind, reloadPapers]);

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
      } catch (err) {
        if (cancelled) return;
        setPinned(new Set());
        setError(err instanceof Error ? err.message : "Could not load pinned files.");
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

  const [creating, setCreating] = useState<{ parentPath: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const cancelCreate = useCallback(() => {
    if (submittingRef.current) return;
    setCreating(null);
    setNewName("");
    setNewError(null);
  }, []);

  const beginCreate = useCallback((parentPath: string) => {
    setCreating({ parentPath });
    setNewName("");
    setNewError(null);
    if (parentPath !== ".") {
      setTree((prev) => {
        if (prev.expanded.has(parentPath)) return prev;
        const expanded = new Set(prev.expanded);
        expanded.add(parentPath);
        return { ...prev, expanded };
      });
    }
  }, []);

  const commitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      cancelCreate();
      return;
    }
    if (name.startsWith(".")) {
      setNewError("Name can't start with a dot.");
      return;
    }
    const segments = name.split("/");
    if (segments.some((s) => s === "" || s === "..")) {
      setNewError("Invalid path.");
      return;
    }
    if (/[<>:"|?*\\]/.test(name)) {
      setNewError("Name contains invalid characters.");
      return;
    }
    const parent = creating?.parentPath ?? ".";
    const relPath = parent === "." ? name : `${parent}/${name}`;
    submittingRef.current = true;
    try {
      await fsCreateFile(rootId, relPath);
      const { entries, hasOpenable } = await walkAndPrecompute(rootId);
      console.info("[create-file]", { rootId, path: relPath, ok: true });
      setTree((prev) => {
        const expanded = new Set(prev.expanded);
        expanded.add(".");
        let p = relPath;
        while (p.includes("/")) {
          p = p.slice(0, p.lastIndexOf("/"));
          expanded.add(p);
        }
        return { expanded, entries, hasOpenable, walking: false };
      });
      setCreating(null);
      setNewName("");
      setNewError(null);
      setOpenFilePath(relPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.info("[create-file]", { rootId, path: relPath, ok: false, reason: msg });
      setNewError(msg.toLowerCase().includes("already exists") ? "File already exists." : msg);
    } finally {
      submittingRef.current = false;
    }
  }, [newName, rootId, creating, cancelCreate, setOpenFilePath]);

  useEffect(() => {
    if (creating && newError && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [creating, newError]);

  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const move = useCallback(
    async (fromPath: string, toParentDir: string) => {
      const { name } = splitPath(fromPath);
      const toPath = toParentDir === "." ? name : `${toParentDir}/${name}`;
      if (fromPath === toPath) return;
      if (isSelfOrDescendant(toPath, fromPath)) return;
      try {
        await fsMovePath(rootId, fromPath, toPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.info("[move-path]", {
          rootId,
          from: fromPath,
          to: toPath,
          ok: false,
          reason: msg,
        });
        setError(
          msg.toLowerCase().includes("already exists")
            ? `A file named "${name}" already exists in ${toParentDir === "." ? "root" : toParentDir}.`
            : msg,
        );
        return;
      }
      const { entries, hasOpenable } = await walkAndPrecompute(rootId);
      setTree((prev) => {
        const expanded = new Set<string>();
        for (const p of prev.expanded) {
          if (p === fromPath) expanded.add(toPath);
          else if (p.startsWith(`${fromPath}/`))
            expanded.add(`${toPath}${p.slice(fromPath.length)}`);
          else expanded.add(p);
        }
        expanded.add(".");
        if (toParentDir !== ".") expanded.add(toParentDir);
        return { expanded, entries, hasOpenable, walking: false };
      });

      buffers.getState().renamePath(fromPath, toPath);

      let pinsChanged = 0;
      setPinned((prev) => {
        const next = new Set<string>();
        for (const pin of prev) {
          if (pin === fromPath) {
            next.add(toPath);
            pinsChanged++;
          } else if (pin.startsWith(`${fromPath}/`)) {
            next.add(`${toPath}${pin.slice(fromPath.length)}`);
            pinsChanged++;
          } else {
            next.add(pin);
          }
        }
        return next;
      });
      const originalPins = await repo.filePins
        .listForProject(project.id)
        .catch(() => [] as { relPath: string }[]);
      for (const pin of originalPins) {
        let rewritten: string | null = null;
        if (pin.relPath === fromPath) rewritten = toPath;
        else if (pin.relPath.startsWith(`${fromPath}/`))
          rewritten = `${toPath}${pin.relPath.slice(fromPath.length)}`;
        if (rewritten === null) continue;
        try {
          await repo.filePins.unpin(project.id, pin.relPath);
          await repo.filePins.pin(project.id, rewritten);
        } catch (err) {
          console.warn("FilesColumn: pin remap failed", pin.relPath, err);
        }
      }

      let papersChanged = 0;
      const allPapers = await repo.papers.list().catch(() => [] as PaperRow[]);
      for (const paper of allPapers) {
        if (paper.projectId !== project.id) continue;
        const patch: { pdfRelPath?: string; entrypointRelPath?: string } = {};
        const remap = (rel: string): string | null => {
          if (rel === fromPath) return toPath;
          if (rel.startsWith(`${fromPath}/`)) return `${toPath}${rel.slice(fromPath.length)}`;
          return null;
        };
        if (paper.pdfRelPath) {
          const r = remap(paper.pdfRelPath);
          if (r !== null) patch.pdfRelPath = r;
        }
        if (paper.entrypointRelPath) {
          const r = remap(paper.entrypointRelPath);
          if (r !== null) patch.entrypointRelPath = r;
        }
        if (Object.keys(patch).length > 0) {
          try {
            await repo.papers.setPaths(paper.id, patch);
            papersChanged++;
          } catch (err) {
            console.warn("FilesColumn: paper path remap failed", paper.id, err);
          }
        }
      }
      if (papersChanged > 0) void reloadPapers();

      if (build?.mainRelPath) {
        let rewrittenMain: string | null = null;
        if (build.mainRelPath === fromPath) rewrittenMain = toPath;
        else if (build.mainRelPath.startsWith(`${fromPath}/`))
          rewrittenMain = `${toPath}${build.mainRelPath.slice(fromPath.length)}`;
        if (rewrittenMain !== null) {
          try {
            await setMain(rewrittenMain, build.mainIsPinned);
          } catch (err) {
            console.warn("FilesColumn: main remap failed", err);
          }
        }
      }

      if (openFilePath === fromPath) setOpenFilePath(toPath);
      else if (openFilePath?.startsWith(`${fromPath}/`))
        setOpenFilePath(`${toPath}${openFilePath.slice(fromPath.length)}`);

      console.info("[move-path]", {
        rootId,
        from: fromPath,
        to: toPath,
        ok: true,
        pinsChanged,
        papersChanged,
      });
    },
    [
      rootId,
      buffers,
      repo.filePins,
      repo.papers,
      project.id,
      reloadPapers,
      build?.mainRelPath,
      build?.mainIsPinned,
      setMain,
      openFilePath,
      setOpenFilePath,
    ],
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
        } catch (err) {
          console.warn("FilesColumn: pin toggle failed; resyncing", path, err);
          try {
            const rows = await repo.filePins.listForProject(project.id);
            setPinned(new Set(rows.map((r) => r.relPath)));
          } catch (resyncErr) {
            console.warn("FilesColumn: pin resync failed", resyncErr);
          }
        }
      })();
    },
    [project.id, repo.filePins],
  );

  const pdfs = useMemo(() => collectPdfs(tree.entries), [tree.entries]);

  const visiblePapers = useMemo(
    () => papers.filter((p) => (markCounts.get(p.id) ?? 0) > 0),
    [papers, markCounts],
  );

  const paperNameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of visiblePapers) {
      if (!p.pdfRelPath) continue;
      const { name } = splitPath(p.pdfRelPath);
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return m;
  }, [visiblePapers]);

  const removePaper = useCallback(
    async (paper: PaperRow) => {
      const marks = markCounts.get(paper.id) ?? 0;
      const ok = window.confirm(
        `Remove ${paper.title} and delete ${marks} mark${marks === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
      if (paper.pdfRelPath && openFilePath === paper.pdfRelPath) setOpenFilePath(null);
      try {
        await repo.papers.remove(paper.id);
      } catch (err) {
        console.warn("FilesColumn: remove paper failed", paper.id, err);
      }
      await reloadPapers();
    },
    [markCounts, openFilePath, setOpenFilePath, repo.papers, reloadPapers],
  );

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

      {visiblePapers.length > 0 && (
        <section className="files__section files__section--papers">
          <div className="files__section-header">
            <span className="files__header-title">
              Papers <span className="files__count">({visiblePapers.length})</span>
            </span>
          </div>
          <ul className="files__flat">
            {visiblePapers.map((paper) => {
              const path = paper.pdfRelPath;
              if (!path) return null;
              const isActive = paper.id === activePaperId;
              const marks = markCounts.get(paper.id) ?? 0;
              const { dir, name } = splitPath(path);
              const collides = (paperNameCounts.get(name) ?? 0) > 1;
              return (
                <li key={`paper:${paper.id}`} className="files__flat-item">
                  <div
                    className={`files__row files__row--paper${isActive ? " files__row--selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="files__row-open"
                      onClick={() => openFile(path)}
                      title={path}
                    >
                      <span className="files__name">{paper.title}</span>
                      {collides && dir !== "." && <span className="files__path-hint">({dir})</span>}
                      <span className="files__paper-meta">
                        {marks} mark{marks === 1 ? "" : "s"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="files__remove"
                      aria-label={`Remove ${paper.title}`}
                      title="Remove paper — deletes all marks"
                      onClick={(event) => {
                        event.stopPropagation();
                        void removePaper(paper);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
          <button
            type="button"
            className="files__new-button"
            aria-label="New file"
            title="New file"
            onClick={() => beginCreate(".")}
            disabled={creating !== null}
          >
            +
          </button>
        </div>
        {tree.walking ? (
          <p className="files__hint">…</p>
        ) : (
          <div
            className={`files__tree${dragOverPath === "." ? " files__tree--drop-root" : ""}`}
            role="tree"
            onDragEnter={(event) => {
              event.preventDefault();
              if (event.target === event.currentTarget) setDragOverPath(".");
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragOverPath(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOverPath(null);
              if (event.target !== event.currentTarget) return;
              const from = event.dataTransfer.getData(DRAG_MIME);
              if (!from) return;
              const { dir } = splitPath(from);
              if (dir === ".") return;
              void move(from, ".");
            }}
          >
            {creating?.parentPath === "." && (
              <NewFileInputRow
                parentPath="."
                depth={0}
                name={newName}
                error={newError}
                inputRef={newInputRef}
                onChange={(v) => {
                  setNewName(v);
                  if (newError) setNewError(null);
                }}
                onCommit={() => void commitCreate()}
                onCancel={cancelCreate}
              />
            )}
            {root.map((entry) => (
              <EntryRow
                key={entry.name}
                path={entry.name}
                entry={entry}
                depth={0}
                tree={tree}
                pinned={pinned}
                mainRelPath={build?.mainRelPath ?? null}
                dragOverPath={dragOverPath}
                setDragOverPath={setDragOverPath}
                callbacks={{
                  onToggle: toggle,
                  onOpenFile: openFile,
                  onTogglePin: togglePin,
                  onToggleMain: toggleMain,
                  onBeginCreate: beginCreate,
                  onMove: (from, to) => void move(from, to),
                  renderCreateInput: (parentPath) =>
                    creating?.parentPath === parentPath ? (
                      <NewFileInputRow
                        parentPath={parentPath}
                        depth={parentPath === "." ? 0 : parentPath.split("/").length}
                        name={newName}
                        error={newError}
                        inputRef={newInputRef}
                        onChange={(v) => {
                          setNewName(v);
                          if (newError) setNewError(null);
                        }}
                        onCommit={() => void commitCreate()}
                        onCancel={cancelCreate}
                      />
                    ) : null,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
