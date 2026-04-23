import { formatReviewPrompt, type PromptAnnotation } from "@obelus/bundle-builder";
import type { PaperRow } from "@obelus/repo";
import { save } from "@tauri-apps/plugin-dialog";
import type { JSX, MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { readClaudeStatus } from "../../boot/detect";
import { fsWriteBytes, fsWriteTextAbs } from "../../ipc/commands";
import { useClaudeConfig } from "../../lib/use-claude-defaults";
import { exportBundleV2ForPaper } from "./build-bundle";
import ClaudeChip from "./ClaudeChip";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import RubricPanel from "./RubricPanel";
import WidenToggle from "./WidenToggle";
import { useWriteUpProgress, useWriteUpRunner, useWriteUpStore } from "./writeup-store-context";

function slugify(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "review"
  );
}

function timestampForFilename(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

type ExportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "json"; relPath: string }
  | { kind: "markdown"; path: string }
  | { kind: "copied" };

interface ReviewerActionsPanelProps {
  wide: boolean;
  onToggleWide: () => void;
}

export default function ReviewerActionsPanel({
  wide,
  onToggleWide,
}: ReviewerActionsPanelProps): JSX.Element {
  const { project, repo, rootId } = useProject();
  const openPaper = useOpenPaper();
  const runner = useWriteUpRunner();
  const store = runner.store;

  const projectIdInStore = store((s) => s.projectId);
  const paperIdInStore = store((s) => s.paperId);
  const body = store((s) => s.body);
  const status = store((s) => s.status);

  const [claudeReady, setClaudeReady] = useState<null | boolean>(null);
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const [savedDraftAt, setSavedDraftAt] = useState<string | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await readClaudeStatus();
      if (!cancelled) setClaudeReady(s.status === "found");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const paperReady = openPaper.kind === "ready";
  const paperId = paperReady ? openPaper.paper.id : null;
  const paperTitle = paperReady ? openPaper.paper.title : "";
  const paperRowForRubric = paperReady ? openPaper.paper : null;

  useEffect(() => {
    if (!paperId) return;
    if (projectIdInStore === project.id && paperIdInStore === paperId) return;
    void store.getState().load(project.id, paperId);
  }, [project.id, paperId, projectIdInStore, paperIdInStore, store]);

  useEffect(() => {
    if (status.kind !== "streaming") return;
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [status.kind]);

  async function readAnnotationsForPrompt(): Promise<{
    paperRow: PaperRow | undefined;
    annotations: PromptAnnotation[];
    revisionNumber: number;
    pdfFilename: string;
  } | null> {
    if (!paperId || openPaper.kind !== "ready") return null;
    const paper = await repo.papers.get(paperId);
    if (!paper) return null;
    const revisions = await repo.revisions.listForPaper(paperId);
    const latest = revisions[revisions.length - 1];
    if (!latest) return null;
    const rows = await repo.annotations.listForRevision(latest.id);
    if (rows.length === 0) return null;
    const annotations: PromptAnnotation[] = rows.map((r) => ({
      id: r.id,
      category: r.category,
      page: r.page,
      quote: r.quote,
      contextBefore: r.contextBefore,
      contextAfter: r.contextAfter,
      note: r.note,
      ...(r.groupId !== undefined ? { groupId: r.groupId } : {}),
    }));
    const pdfFilename = openPaper.path.split("/").pop() ?? "";
    return { paperRow: paper, annotations, revisionNumber: latest.revisionNumber, pdfFilename };
  }

  async function onExportJSON(): Promise<void> {
    if (!paperReady || !paperId) return;
    setExportState({ kind: "idle" });
    try {
      const { filename, json } = await exportBundleV2ForPaper({ repo, paperId, rootId });
      const bytes = new TextEncoder().encode(json);
      await fsWriteBytes(rootId, filename, bytes);
      setExportState({ kind: "json", relPath: filename });
    } catch (err) {
      setExportState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not export bundle.",
      });
    }
  }

  async function onExportMarkdown(): Promise<void> {
    if (!paperReady) return;
    setExportState({ kind: "idle" });
    try {
      const ctx = await readAnnotationsForPrompt();
      if (!ctx) {
        setExportState({ kind: "error", message: "No marks on this paper yet." });
        return;
      }
      const paper = ctx.paperRow;
      if (!paper) {
        setExportState({ kind: "error", message: "Paper not found." });
        return;
      }
      const text = formatReviewPrompt({
        paper: {
          title: paperTitle || "Paper",
          revisionNumber: ctx.revisionNumber,
          pdfFilename: ctx.pdfFilename,
          pdfSha256: paper.pdfSha256,
        },
        annotations: ctx.annotations,
        ...(paper.rubric ? { rubric: { label: paper.rubric.label, body: paper.rubric.body } } : {}),
      });
      const defaultName = `review-${slugify(paperTitle || "paper")}-${timestampForFilename()}.md`;
      const picked = await save({
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!picked) return;
      await fsWriteTextAbs(picked, text);
      setExportState({ kind: "markdown", path: picked });
    } catch (err) {
      setExportState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not export Markdown.",
      });
    }
  }

  async function onCopyPrompt(): Promise<void> {
    if (!paperReady) return;
    setExportState({ kind: "idle" });
    try {
      const ctx = await readAnnotationsForPrompt();
      if (!ctx) {
        setExportState({ kind: "error", message: "No marks on this paper yet." });
        return;
      }
      const paper = ctx.paperRow;
      if (!paper) {
        setExportState({ kind: "error", message: "Paper not found." });
        return;
      }
      const text = formatReviewPrompt({
        paper: {
          title: paperTitle || "Paper",
          revisionNumber: ctx.revisionNumber,
          pdfFilename: ctx.pdfFilename,
          pdfSha256: paper.pdfSha256,
        },
        annotations: ctx.annotations,
        ...(paper.rubric ? { rubric: { label: paper.rubric.label, body: paper.rubric.body } } : {}),
      });
      await navigator.clipboard.writeText(text);
      setExportState({ kind: "copied" });
      window.setTimeout(() => {
        setExportState((prev) => (prev.kind === "copied" ? { kind: "idle" } : prev));
      }, 1800);
    } catch (err) {
      setExportState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not copy prompt.",
      });
    }
  }

  async function onDraft(): Promise<void> {
    if (!paperId) return;
    setSavedDraftAt(null);
    setDraftCopied(false);
    await runner.beginDraft(paperId, paperTitle);
  }

  async function onCancel(): Promise<void> {
    await runner.cancelDraft();
  }

  async function onSaveDraft(): Promise<void> {
    if (openPaper.kind !== "ready") return;
    await store.getState().save();
    const pdfName = openPaper.path.split("/").pop() ?? "paper";
    const defaultName = `review-${slugify(pdfName)}-${timestampForFilename()}.md`;
    const picked = await save({
      defaultPath: defaultName,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!picked) return;
    await fsWriteTextAbs(picked, body);
    setSavedDraftAt(picked);
  }

  async function onCopyDraft(): Promise<void> {
    await navigator.clipboard.writeText(body);
    setDraftCopied(true);
    window.setTimeout(() => setDraftCopied(false), 1800);
  }

  const streaming = status.kind === "streaming";
  const hasBody = body.length > 0;

  if (!paperReady) {
    return (
      <section className="reviewer-actions" aria-label="Review">
        <p className="reviewer-actions__empty">Open the PDF to begin.</p>
      </section>
    );
  }

  return (
    <section className="reviewer-actions" aria-label="Review">
      <header className="reviewer-actions__head">
        <h2 className="reviewer-actions__heading">Reviewer's letter</h2>
        <div className="reviewer-actions__head-tools">
          {claudeReady ? <ClaudeChip /> : null}
          <WidenToggle wide={wide} onToggle={onToggleWide} />
        </div>
      </header>
      <RubricPanel paper={paperRowForRubric} />
      <p className="reviewer-actions__hint">
        {claudeReady === true
          ? "Hand your marks to Claude Code for a journal-style reviewer's letter — draft it here, or copy the command and run it yourself."
          : "Hand your marks to a coding agent and get back a journal-style reviewer's letter. Pick a handoff below."}
      </p>

      {claudeReady === true ? (
        <ClaudeAction
          streaming={streaming}
          hasBody={hasBody}
          body={body}
          outputRef={outputRef}
          onDraft={() => void onDraft()}
          onCancel={() => void onCancel()}
          onSaveDraft={() => void onSaveDraft()}
          onCopyDraft={() => void onCopyDraft()}
          savedAt={savedDraftAt}
          copied={draftCopied}
          error={status.kind === "error" ? status.message : null}
        />
      ) : null}

      {claudeReady === true ? (
        <p className="reviewer-actions__handoff-label">Or hand off manually</p>
      ) : null}

      <ExportChips
        onExportJSON={() => void onExportJSON()}
        onExportMarkdown={() => void onExportMarkdown()}
        onCopyPrompt={() => void onCopyPrompt()}
        state={exportState}
      />
    </section>
  );
}

interface ChipsProps {
  onExportJSON: () => void;
  onExportMarkdown: () => void;
  onCopyPrompt: () => void;
  state: ExportState;
}

function ExportChips({
  onExportJSON,
  onExportMarkdown,
  onCopyPrompt,
  state,
}: ChipsProps): JSX.Element {
  return (
    <fieldset className="reviewer-actions__chips" aria-label="Review output">
      <button type="button" className="reviewer-actions__chip" onClick={onExportJSON}>
        <span className="reviewer-actions__chip-label">JSON bundle</span>
        <span className="reviewer-actions__chip-hint">
          {state.kind === "json" ? state.relPath : "bundle-<ts>.json"}
        </span>
      </button>
      <button type="button" className="reviewer-actions__chip" onClick={onExportMarkdown}>
        <span className="reviewer-actions__chip-label">Markdown</span>
        <span className="reviewer-actions__chip-hint">
          {state.kind === "markdown" ? state.path : "choose where to save…"}
        </span>
      </button>
      <button type="button" className="reviewer-actions__chip" onClick={onCopyPrompt}>
        <span className="reviewer-actions__chip-label">Copy to clipboard</span>
        <span className="reviewer-actions__chip-hint">
          {state.kind === "copied" ? "Copied" : "paste into any agent"}
        </span>
      </button>
      {state.kind === "json" ? <NextStep command={`/write-review ${state.relPath}`} /> : null}
      {state.kind === "error" ? (
        <p className="reviewer-actions__status" data-status="error">
          {state.message}
        </p>
      ) : null}
    </fieldset>
  );
}

interface ClaudeProps {
  streaming: boolean;
  hasBody: boolean;
  body: string;
  outputRef: MutableRefObject<HTMLDivElement | null>;
  onDraft: () => void;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCopyDraft: () => void;
  savedAt: string | null;
  copied: boolean;
  error: string | null;
}

function ClaudeAction({
  streaming,
  hasBody,
  body,
  outputRef,
  onDraft,
  onCancel,
  onSaveDraft,
  onCopyDraft,
  savedAt,
  copied,
  error,
}: ClaudeProps): JSX.Element {
  const progressStore = useWriteUpProgress();
  const writeupStore = useWriteUpStore();
  const phase = progressStore((s) => s.phase);
  const toolEvents = progressStore((s) => s.toolEvents);
  const assistantChars = progressStore((s) => s.assistantChars);
  const transcript = writeupStore((s) => s.transcript);
  // Surface the implicit sonnet default the desktop applies to write-review
  // when the user hasn't picked a model. The CLI default still wins for ask
  // and apply-revision; only this surface biases towards sonnet.
  const claudeConfig = useClaudeConfig();
  const writeReviewModelHint =
    claudeConfig.model === null
      ? "Defaults to Sonnet for write-up — pick a different model in the chip above."
      : null;
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptRef = useRef<HTMLPreElement | null>(null);

  const transcriptLen = transcript.length;
  useEffect(() => {
    if (!transcriptOpen || !streaming) return;
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // transcriptLen is the scroll trigger.
    void transcriptLen;
  }, [transcriptLen, transcriptOpen, streaming]);

  const phaseLabel = streaming
    ? phase || (assistantChars > 0 ? "Drafting…" : "Reading your marks…")
    : hasBody
      ? "Draft ready."
      : "Idle.";

  return (
    <div className="reviewer-actions__claude">
      <div className="reviewer-actions__claude-head">
        {streaming ? (
          <button type="button" className="btn btn--subtle" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={onDraft}>
            {hasBody ? "Re-draft reviewer's letter" : "Draft reviewer's letter"}
          </button>
        )}
        {streaming ? <span className="reviewer-actions__pulse" aria-hidden="true" /> : null}
        <span className="reviewer-actions__claude-label">{phaseLabel}</span>
      </div>

      {writeReviewModelHint && !streaming ? (
        <p className="reviewer-actions__model-hint">{writeReviewModelHint}</p>
      ) : null}

      {streaming ? (
        <div className="reviewer-actions__progress-row">
          <p className="reviewer-actions__progress">
            {toolEvents} tool{toolEvents === 1 ? "" : "s"}
            {transcript.length > 0 ? ` · ${transcript.length.toLocaleString()} chars streamed` : ""}
          </p>
          <button
            type="button"
            className="reviewer-actions__transcript-toggle"
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-expanded={transcriptOpen}
          >
            {transcriptOpen ? "hide live output" : "show live output"}
          </button>
        </div>
      ) : null}

      {!streaming && hasBody ? (
        <div ref={outputRef} className="reviewer-actions__output" aria-live="polite">
          <pre className="reviewer-actions__output-pre">{body}</pre>
        </div>
      ) : null}

      {transcript.length > 0 ? (
        <>
          {!streaming ? (
            <div className="reviewer-actions__progress-row reviewer-actions__progress-row--after">
              <p className="reviewer-actions__progress">
                Claude's full output · {transcript.length.toLocaleString()} chars
              </p>
              <button
                type="button"
                className="reviewer-actions__transcript-toggle"
                onClick={() => setTranscriptOpen((v) => !v)}
                aria-expanded={transcriptOpen}
              >
                {transcriptOpen ? "hide" : "show"}
              </button>
            </div>
          ) : null}
          {transcriptOpen ? (
            <div className="reviewer-actions__transcript" aria-live="polite">
              <pre ref={transcriptRef} className="reviewer-actions__transcript-pre">
                {transcript || "waiting for Claude…"}
                {streaming ? <span className="reviewer-actions__caret" aria-hidden="true" /> : null}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}

      {hasBody && !streaming ? (
        <div className="reviewer-actions__claude-foot">
          <button type="button" className="btn btn--subtle" onClick={onSaveDraft}>
            Save as Markdown
          </button>
          <button type="button" className="btn btn--subtle" onClick={onCopyDraft}>
            {copied ? "Copied" : "Copy"}
          </button>
          {savedAt ? (
            <span className="reviewer-actions__hint-inline">Written to {savedAt}</span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="reviewer-actions__status" data-status="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function NextStep({ command }: { command: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="reviewer-actions__next">
      <p className="reviewer-actions__next-label">Next: in your paper folder, run</p>
      <button
        type="button"
        className="reviewer-actions__next-cmd"
        data-copied={copied ? "true" : "false"}
        onClick={onCopy}
        title={copied ? "Copied" : "Copy to clipboard"}
      >
        <code>{command}</code>
        <span className="reviewer-actions__next-hint" aria-hidden="true">
          {copied ? "Copied" : "Click to copy"}
        </span>
      </button>
    </div>
  );
}
