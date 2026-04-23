import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
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
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { fsReadFile } from "../../ipc/commands";
import { setActiveSourceView } from "./active-source-view";
import { useBuffersStore } from "./buffers-store-context";
import CompileMainButton from "./CompileMainButton";
import { useProject } from "./context";
import DraftsRail from "./DraftsRail";
import { editorTheme } from "./editor-theme";
import { extensionOf } from "./openable";
import SwitchResolveBanner from "./SwitchResolveBanner";
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
  const entry = buffers((s) => s.buffers.get(relPath));
  const dirty = buffers((s) => s.isDirty(relPath));
  const externalVersion = buffers((s) => s.buffers.get(relPath)?.externalVersion ?? 0);
  const pendingSwitch = buffers((s) => s.pendingSwitch);
  const locked = useSourceLocked();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  // Bumped by the "retry" button so a transient read failure can be re-tried
  // on demand without remounting the pane.
  const [retryTick, setRetryTick] = useState(0);
  const [hadInvalidBytes, setHadInvalidBytes] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // One compartment per mount; holds the editable/readOnly extensions so we
  // can reconfigure the flag when `locked` flips without rebuilding the view.
  const editableCompartment = useMemo(() => new Compartment(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `retryTick` is a deliberate re-fire trigger — the body doesn't read its value, just needs the effect to re-run when the user clicks "retry" after a transient read failure.
  useEffect(() => {
    buffers.getState().setCurrentPath(relPath);
    if (entry) {
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
  }, [rootId, relPath, entry, buffers, retryTick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `locked` seeds the compartment once on view creation; lock flips are handled by the reconfigure effect below. Adding it to deps would rebuild the view on every flip and lose caret/scroll position.
  useEffect(() => {
    // Gate on `entry` (the buffer for this relPath) instead of `load.kind`.
    // When the user switches files, `load.kind` briefly stays "ready" from
    // the *previous* file's async completion — if we gated on that, we'd
    // mount an editor with an empty doc for the new file before its read
    // lands. `entry` is the authoritative "buffer for THIS relPath is
    // hydrated" signal and re-fires the effect via its selector subscription.
    if (!entry) return;
    const host = hostRef.current;
    if (!host) return;
    // Remount the editor when the buffer is replaced from disk (e.g. after
    // apply-hunks). `externalVersion` is read so biome keeps it in the deps.
    void externalVersion;
    const initial = entry.text;

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
    setActiveSourceView(view);
    return () => {
      setActiveSourceView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [entry, relPath, externalVersion, buffers, editableCompartment]);

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
      <div className="source-pane__editor" ref={hostRef} />
      <DraftsRail />
      <footer className="source-pane__foot">
        <span className="source-pane__foot-path">
          {dirty && (
            <span className="source-pane__foot-dot" aria-hidden="true">
              •
            </span>
          )}
          {relPath}
        </span>
        <CompileMainButton />
        <button
          type="button"
          className="btn btn--subtle"
          disabled={!dirty}
          onClick={() => void buffers.getState().save(relPath)}
        >
          Save (⌘S)
        </button>
      </footer>
    </div>
  );
}
