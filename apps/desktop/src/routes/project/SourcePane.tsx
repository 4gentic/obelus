import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import type { ClassifyResult } from "@obelus/html-view";
import { usePaperTrust } from "../../store/use-paper-trust";
import "@obelus/md-view/md.css";
import { type JSX, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { fsReadFile } from "../../ipc/commands";
import { setActiveSourceView } from "./active-source-view";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import { editorTheme } from "./editor-theme";
import { useFindStore } from "./find-store-context";
import HtmlReviewSurface from "./HtmlReviewSurface";
import MdReviewSurface from "./MdReviewSurface";
import { extensionOf } from "./openable";
import SwitchResolveBanner from "./SwitchResolveBanner";
import { useAssetResolver } from "./use-asset-resolver";
import { useSourceLocked } from "./use-source-lock";

interface Props {
  rootId: string;
  relPath: string;
}

function langForPath(path: string): Extension[] {
  const ext = extensionOf(path);
  if (ext === "md") return [markdown(), EditorView.lineWrapping];
  if (ext === "html") return [html()];
  return [];
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

// Widening-backoff retries for `fs_read_file`. The auto-compile Typst
// pipeline and concurrent plan/apply can briefly hold a source file past
// half a second during back-to-back cycles, which is the window the user
// is most likely to switch tabs and hit. Total worst-case wait ≈ 1.55 s
// across four attempts — still faster than the user noticing if it
// recovers.
const READ_BACKOFFS_MS = [150, 400, 900] as const;

async function readWithRetry(rootId: string, relPath: string): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= READ_BACKOFFS_MS.length; attempt++) {
    try {
      const bytes = await fsReadFile(rootId, relPath);
      if (attempt > 0) {
        console.info("[source-load]", { relPath, attempt: attempt + 1, outcome: "recovered" });
      }
      return bytes;
    } catch (err) {
      lastErr = err;
      const detail = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      const delay = READ_BACKOFFS_MS[attempt];
      if (delay === undefined) {
        console.warn("[source-load]", { relPath, attempt: attempt + 1, detail, outcome: "giveup" });
        break;
      }
      console.warn("[source-load]", {
        relPath,
        attempt: attempt + 1,
        detail,
        nextDelayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

interface LoadedBuffer {
  text: string;
  hadInvalidBytes: boolean;
}

// Source files (.tex/.md/.typ/etc.) are UTF-8 by contract, but a transient
// read against a file mid-write can occasionally surface odd bytes. Decode
// with `fatal: false` so a single bad byte doesn't turn the whole pane into
// an error state — replacement characters render inline and the user can
// see exactly where the problem is. The caller gets `hadInvalidBytes` so
// the UI can surface a soft warning without blocking the open.
function decodeSource(buffer: ArrayBuffer): LoadedBuffer {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { text, hadInvalidBytes: text.includes("�") };
}

export default function SourcePane({ rootId, relPath }: Props): JSX.Element {
  const buffers = useBuffersStore();
  const { setOpenFilePath } = useProject();
  // Subscribe to a boolean hydration flag, not the full BufferEntry. setText
  // allocates a new entry object on every keystroke; using it as an effect
  // dep would re-run the view-mount effect per keystroke and destroy the
  // CodeMirror view (losing focus and the per-view undo history).
  const hasEntry = buffers((s) => s.buffers.has(relPath));
  const dirty = buffers((s) => s.isDirty(relPath));
  const externalVersion = buffers((s) => s.buffers.get(relPath)?.externalVersion ?? 0);
  // Subscribed for the MD/HTML preview paths below. Source-mode renders skip
  // the dependent branches so re-renders here are cheap; CodeMirror owns its
  // own DOM and isn't rebuilt because `hasEntry` / `externalVersion` drive
  // the view-mount effect, not `bufferText`.
  const bufferText = buffers((s) => s.buffers.get(relPath)?.text ?? "");
  const pendingSwitch = buffers((s) => s.pendingSwitch);
  const pendingExternalReload = buffers((s) =>
    s.pendingExternalReload?.relPath === relPath ? s.pendingExternalReload : null,
  );
  const locked = useSourceLocked();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  // Bumped by the "retry" button so a transient read failure can be re-tried
  // on demand without remounting the pane.
  const [retryTick, setRetryTick] = useState(0);
  const [hadInvalidBytes, setHadInvalidBytes] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "preview">("preview");
  const ext = extensionOf(relPath);
  const isMd = ext === "md";
  const isHtml = ext === "html" || ext === "htm";
  const hasPreview = isMd || isHtml;
  useEffect(() => {
    setViewMode(hasPreview ? "preview" : "source");
  }, [hasPreview]);
  // HTML writer-mode preview: defer the buffer off the keystroke fast path
  // via `useDeferredValue` so the editor stays at 60 fps. HtmlView sanitizes
  // its `html` prop internally; `deferredBuffer` arrives there as the full
  // authored document (head + body) and is rendered faithfully inside the
  // sandboxed iframe. Writer HTML is hand-authored by definition (the user
  // is the author), so classification is a fixed `{ mode: "html" }`; pairing
  // detection only matters for reviewer-mode files dropped in from elsewhere.
  const deferredBuffer = useDeferredValue(bufferText);
  const previewHtml = isHtml && viewMode === "preview" ? deferredBuffer : null;
  const htmlClassification: ClassifyResult = useMemo(() => ({ mode: "html" }), []);
  const htmlAssets = useAssetResolver(rootId, relPath);
  // Writer-mode previews don't have a `paperId` (the file isn't necessarily
  // registered as a paper yet), so derive a synthetic trust key from the
  // root id + path. The user is the author, but the banner is still
  // informative — it surfaces external resources the author may not have
  // intended to ship and lets them grant trust once instead of every preview.
  const writerTrustKey = hasPreview ? `writer:${rootId}:${relPath}` : null;
  const writerTrust = usePaperTrust(writerTrustKey);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // One compartment per mount; holds the editable/readOnly extensions so we
  // can reconfigure the flag when `locked` flips without rebuilding the view.
  const editableCompartment = useMemo(() => new Compartment(), []);

  // Bridge find state across the source ↔ preview toggle. The two surfaces
  // own different find UIs (CodeMirror's panel with replace, vs. the shared
  // FindBar without), but the user expects the typed query + case-sensitivity
  // to follow the toggle so they don't have to retype.
  const findStore = useFindStore();
  const prevViewModeRef = useRef(viewMode);
  const prevPathRef = useRef(relPath);
  useEffect(() => {
    const prevMode = prevViewModeRef.current;
    const prevPath = prevPathRef.current;
    prevViewModeRef.current = viewMode;
    prevPathRef.current = relPath;
    // File swap — let `resetForPaperSwap` (in find-store-context) handle the
    // wipe; bridging stale state into the new file's CM would leak the prior
    // query.
    if (prevPath !== relPath) return;
    if (prevMode === viewMode) return;

    if (viewMode === "source") {
      const { isOpen, query, caseSensitive } = findStore.getState();
      // Always close the FindBar on the toggle. It's a parent-level overlay
      // and would otherwise hover above the source pane regardless of whether
      // we have a query to bridge.
      if (isOpen) findStore.getState().close();
      if (query.length === 0) return;
      const view = viewRef.current;
      if (!view) return;
      openSearchPanel(view);
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive })),
      });
      return;
    }

    // viewMode === "preview"
    const view = viewRef.current;
    if (!view) return;
    const cmQuery = getSearchQuery(view.state);
    // Always close the CM search panel on the toggle. The editor host is
    // hidden but mounted, so a leftover panel stays visible above the
    // preview surface unless we explicitly close it.
    closeSearchPanel(view);
    if (cmQuery.search.length === 0) return;
    const store = findStore.getState();
    if (store.caseSensitive !== cmQuery.caseSensitive) {
      store.setCaseSensitive(cmQuery.caseSensitive);
    }
    if (store.query !== cmQuery.search) {
      store.setQuery(cmQuery.search);
    }
    store.open();
  }, [viewMode, relPath, findStore]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `retryTick` is a deliberate re-fire trigger — the body doesn't read its value, just needs the effect to re-run when the user clicks "retry" after a transient read failure.
  useEffect(() => {
    buffers.getState().setCurrentPath(relPath);
    if (hasEntry) {
      setLoad({ kind: "ready" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const buffer = await readWithRetry(rootId, relPath);
        const { text, hadInvalidBytes: bad } = decodeSource(buffer);
        if (!cancelled) {
          buffers.getState().hydrate(relPath, text);
          setHadInvalidBytes(bad);
          setLoad({ kind: "ready" });
        }
      } catch (err) {
        if (cancelled) return;
        const detail =
          err instanceof Error ? err.message : typeof err === "string" ? err : "read failed";
        console.warn("[source-load]", { relPath, attempt: "final", detail });
        setLoad({ kind: "error", message: detail });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, relPath, hasEntry, buffers, retryTick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `locked` seeds the compartment once on view creation; lock flips are handled by the reconfigure effect below. Adding it to deps would rebuild the view on every flip and lose caret/scroll position.
  useEffect(() => {
    // Gate on `hasEntry` (the buffer for this relPath is hydrated) instead
    // of `load.kind`. When the user switches files, `load.kind` briefly
    // stays "ready" from the *previous* file's async completion — if we
    // gated on that, we'd mount an editor with an empty doc for the new
    // file before its read lands. Reading the full entry via the store
    // inside the effect (rather than via a selector subscription) keeps
    // per-keystroke setText churn out of this effect's deps.
    if (!hasEntry) return;
    const host = hostRef.current;
    if (!host) return;
    // Remount the editor when the buffer is replaced from disk (e.g. after
    // apply-hunks). `externalVersion` is read so biome keeps it in the deps.
    void externalVersion;
    const initial = buffers.getState().buffers.get(relPath)?.text ?? "";

    const saveCmd = (): boolean => {
      void buffers.getState().save(relPath);
      return true;
    };

    let view: EditorView;
    try {
      const state = EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          search({ top: true }),
          ...langForPath(relPath),
          editorTheme(),
          keymap.of([
            { key: "Mod-s", run: saveCmd, preventDefault: true },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          // Seed with the current lock state so a view rebuilt after a file
          // switch (while a review is already pending) starts read-only. The
          // reconfigure effect below handles later flips without rebuilding
          // the view — `locked` is intentionally NOT in this effect's deps.
          editableCompartment.of([
            EditorState.readOnly.of(locked),
            EditorView.editable.of(!locked),
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            buffers.getState().setText(relPath, u.state.doc.toString());
          }),
        ],
      });
      view = new EditorView({ state, parent: host });
    } catch (err) {
      // Surface editor-construction failures (e.g. a language extension
      // throwing on pathological input) as a readable error in the pane
      // rather than an uncaught exception that leaves the pane blank.
      const detail = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      console.warn("[source-load]", { relPath, phase: "editor-create", detail });
      setLoad({ kind: "error", message: `Editor failed to mount: ${detail || "unknown error"}` });
      return;
    }
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [hasEntry, relPath, externalVersion, buffers, editableCompartment]);

  // The CodeMirror host stays mounted (just `hidden`) while the user is in
  // preview mode so toggling back doesn't lose caret/scroll. But the global
  // Cmd+F handler in ProjectShell prefers an "active source view" over the
  // shared FindBar — registering an offscreen view would route Cmd+F into a
  // hidden CodeMirror search panel instead of opening the MD/HTML find UI.
  // Gate the registration on `viewMode` so only the visible surface claims it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: relPath and externalVersion are intentional re-fire triggers — the view-mount effect destroys/recreates `viewRef.current` when either flips, and this effect needs to re-run afterwards so the active ref points at the new view.
  useEffect(() => {
    if (!hasEntry) return;
    const view = viewRef.current;
    if (!view) return;
    if (viewMode === "preview") {
      setActiveSourceView(null);
      return;
    }
    setActiveSourceView(view);
    return () => {
      setActiveSourceView(null);
    };
  }, [viewMode, hasEntry, relPath, externalVersion]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure([
        EditorState.readOnly.of(locked),
        EditorView.editable.of(!locked),
      ]),
    });
  }, [locked, editableCompartment]);

  useEffect(() => {
    // Defense-in-depth: the CodeMirror `editable.of(false)` above prevents
    // most edits, but ⌘S, paste from the command palette, or a future
    // programmatic save would still call `buffers.save()` directly. Park a
    // veto on the store so those paths throw cleanly.
    if (!locked) {
      buffers.getState().setWriteGuard(null);
      return;
    }
    buffers.getState().setWriteGuard(() => "Review pending — apply or discard first.");
    return () => {
      buffers.getState().setWriteGuard(null);
    };
  }, [locked, buffers]);

  if (load.kind === "loading") return <div className="pane pane--empty">Loading…</div>;
  if (load.kind === "error") {
    return (
      <div className="pane pane--empty">
        <p>Could not read this file.</p>
        <p className="pane__sub">
          <code>{relPath}</code>
        </p>
        <p className="pane__sub pane__sub--detail">{load.message}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLoad({ kind: "loading" });
            setRetryTick((n) => n + 1);
          }}
        >
          retry
        </button>
      </div>
    );
  }

  return (
    <div className="source-pane">
      {locked && (
        <p className="source-pane__lock" role="status">
          Review pending — apply or discard before editing.
        </p>
      )}
      {hadInvalidBytes && (
        <p className="source-pane__lock" role="status">
          This file contains bytes that aren't valid UTF-8; they're shown as � and will be preserved
          as replacement characters if you save.
        </p>
      )}
      {pendingSwitch !== null && dirty && (
        <SwitchResolveBanner
          from={relPath}
          to={pendingSwitch}
          onSave={() => {
            const target = pendingSwitch;
            void buffers
              .getState()
              .save(relPath)
              .then(() => {
                buffers.getState().clearPendingSwitch();
                setOpenFilePath(target);
              });
          }}
          onDiscard={() => {
            const target = pendingSwitch;
            buffers.getState().discard(relPath);
            buffers.getState().clearPendingSwitch();
            setOpenFilePath(target);
          }}
          onCancel={() => buffers.getState().clearPendingSwitch()}
        />
      )}
      {pendingExternalReload !== null && (
        <div className="source-pane__switch-banner" role="alertdialog" aria-live="assertive">
          <p className="source-pane__switch-text">
            This file changed on disk while you were editing. Reload loses your in-editor changes;
            keeping yours will overwrite the disk version on next Save.
          </p>
          <div className="source-pane__switch-actions">
            <button
              type="button"
              className="btn btn--subtle"
              onClick={() => buffers.getState().setPendingExternalReload(null)}
            >
              Keep mine
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                buffers.getState().discard(relPath);
                void buffers
                  .getState()
                  .refreshFromDisk([relPath])
                  .then(() => {
                    buffers.getState().setPendingExternalReload(null);
                  });
              }}
            >
              Reload from disk
            </button>
          </div>
        </div>
      )}
      {hasPreview && (
        <div className="source-pane__viewmode" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            className={`source-pane__viewmode-opt${viewMode === "preview" ? " is-active" : ""}`}
            aria-selected={viewMode === "preview"}
            onClick={() => setViewMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            role="tab"
            className={`source-pane__viewmode-opt${viewMode === "source" ? " is-active" : ""}`}
            aria-selected={viewMode === "source"}
            onClick={() => setViewMode("source")}
          >
            Source
          </button>
        </div>
      )}
      <div
        className="source-pane__editor"
        ref={hostRef}
        hidden={hasPreview && viewMode === "preview"}
      />
      {isMd && viewMode === "preview" && (
        <div className="source-pane__preview">
          <MdReviewSurface
            path={relPath}
            text={bufferText}
            trusted={writerTrust.trusted}
            onTrust={writerTrust.trust}
          />
        </div>
      )}
      {isHtml && viewMode === "preview" && previewHtml !== null && (
        <div className="source-pane__preview">
          <HtmlReviewSurface
            path={relPath}
            html={previewHtml}
            classification={htmlClassification}
            assets={htmlAssets}
            trusted={writerTrust.trusted}
            onTrust={writerTrust.trust}
          />
        </div>
      )}
    </div>
  );
}
