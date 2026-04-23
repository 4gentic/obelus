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
import { EditorState, type Extension } from "@codemirror/state";
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
import { type JSX, useEffect, useRef, useState } from "react";
import { fsReadFile } from "../../ipc/commands";
import { setActiveSourceView } from "./active-source-view";
import { useBuffersStore } from "./buffers-store-context";
import CompileMainButton from "./CompileMainButton";
import { useProject } from "./context";
import DraftsRail from "./DraftsRail";
import { editorTheme } from "./editor-theme";
import { extensionOf } from "./openable";
import SwitchResolveBanner from "./SwitchResolveBanner";

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

export default function SourcePane({ rootId, relPath }: Props): JSX.Element {
  const buffers = useBuffersStore();
  const { setOpenFilePath } = useProject();
  const entry = buffers((s) => s.buffers.get(relPath));
  const dirty = buffers((s) => s.isDirty(relPath));
  const externalVersion = buffers((s) => s.buffers.get(relPath)?.externalVersion ?? 0);
  const pendingSwitch = buffers((s) => s.pendingSwitch);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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
        const buffer = await fsReadFile(rootId, relPath);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buffer));
        if (!cancelled) {
          buffers.getState().hydrate(relPath, text);
          setLoad({ kind: "ready" });
        }
      } catch (err) {
        if (!cancelled) {
          setLoad({
            kind: "error",
            message: err instanceof Error ? err.message : "Not a text file.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, relPath, entry, buffers]);

  useEffect(() => {
    if (load.kind !== "ready") return;
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
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          buffers.getState().setText(relPath, u.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    setActiveSourceView(view);
    return () => {
      setActiveSourceView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [load.kind, relPath, externalVersion, buffers]);

  if (load.kind === "loading") return <div className="pane pane--empty">Loading…</div>;
  if (load.kind === "error") {
    return (
      <div className="pane pane--empty">
        <p>Not a text file.</p>
        <p className="pane__sub">
          <code>{relPath}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="source-pane">
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
