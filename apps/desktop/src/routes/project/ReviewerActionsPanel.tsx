import { formatReviewPrompt, type PromptAnnotation } from "@obelus/bundle-builder";
import { type MarksArchiveMark, parseMarksArchive } from "@obelus/bundle-schema";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import { buildMarksArchive, importMarksArchive } from "@obelus/marks-transfer";
import type { PaperRow } from "@obelus/repo";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { JSX, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useAiEngine } from "../../hooks/use-ai-engine";
import { fsWriteBytes, fsWriteTextAbs } from "../../ipc/commands";
import { exportBundleForPaper, exportMdBundleForPaper } from "./build-bundle";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import RubricPanel from "./RubricPanel";
import { useReanchor } from "./reanchor-context";
import { useReviewStore } from "./store-context";
import { useWriteUpProgress, useWriteUpRunner, useWriteUpStore } from "./writeup-store-context";

const MARKS_TOOL_VERSION = "0.1.0";

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

type MarksStatus =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "ok"; message: string };

export default function ReviewerActionsPanel(): JSX.Element {
  const { project, repo, rootId } = useProject();
  const openPaper = useOpenPaper();
  const runner = useWriteUpRunner();
  const store = runner.store;

  const projectIdInStore = store((s) => s.projectId);
  const paperIdInStore = store((s) => s.paperId);
  const body = store((s) => s.body);
  const status = store((s) => s.status);

  const engine = useAiEngine();
  // Tri-state: null while detection is in flight, true when an engine is
  // ready to spawn, false when none are. Drives the panel between the
  // single-engine drafting affordance and the manual-handoff fallback.
  const engineReady =
    engine.claudeCode === "checking" || engine.openCode === "checking"
      ? null
      : engine.active !== null;
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const [marksStatus, setMarksStatus] = useState<MarksStatus>({ kind: "idle" });
  const [savedDraftAt, setSavedDraftAt] = useState<string | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const reviewStore = useReviewStore();
  const reanchorProvider = useReanchor();

  const pdfReady = openPaper.kind === "ready";
  const mdReady = openPaper.kind === "ready-md" && openPaper.paper !== null;
  const paperReady = pdfReady || mdReady;
  const activePaper = pdfReady
    ? openPaper.paper
    : openPaper.kind === "ready-md"
      ? openPaper.paper
      : null;
  const paperId = activePaper?.id ?? null;
  const paperTitle = activePaper?.title ?? "";
  const paperRowForRubric = activePaper;

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
    // The reviewer clipboard prompt for PDF papers anchors marks by page
    // number. MD-anchored rows have no page and ride a separate export flow.
    const pdfFilename = openPaper.path.split("/").pop() ?? "";
    const annotations: PromptAnnotation[] = rows.flatMap((r) => {
      if (r.anchor.kind !== "pdf") return [];
      return [
        {
          id: r.id,
          category: r.category,
          quote: r.quote,
          contextBefore: r.contextBefore,
          contextAfter: r.contextAfter,
          note: r.note,
          locator: { kind: "pdf", file: pdfFilename, page: r.anchor.page },
          ...(r.groupId !== undefined ? { groupId: r.groupId } : {}),
        },
      ];
    });
    return { paperRow: paper, annotations, revisionNumber: latest.revisionNumber, pdfFilename };
  }

  async function onExportJSON(): Promise<void> {
    if (!paperReady || !paperId) return;
    setExportState({ kind: "idle" });
    try {
      const { filename, json } = mdReady
        ? await exportMdBundleForPaper({ repo, paperId })
        : await exportBundleForPaper({ repo, paperId, rootId });
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

  async function onExportMarks(): Promise<void> {
    if (!paperReady || !paperId || !activePaper) return;
    setMarksStatus({ kind: "idle" });
    try {
      const revisions = await repo.revisions.listForPaper(paperId);
      const latest = revisions[revisions.length - 1];
      if (!latest) {
        setMarksStatus({ kind: "error", message: "Paper has no revision yet." });
        return;
      }
      const rows = await repo.annotations.listForRevision(latest.id);
      const archive = buildMarksArchive({
        rows,
        document: {
          format: activePaper.format,
          title: activePaper.title,
          pdfSha256: activePaper.pdfSha256,
          ...(activePaper.pageCount !== undefined ? { pageCount: activePaper.pageCount } : {}),
        },
        categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
        toolVersion: MARKS_TOOL_VERSION,
      });
      const defaultName = `marks-${slugify(paperTitle || "paper")}-${timestampForFilename()}.json`;
      const picked = await save({
        defaultPath: defaultName,
        filters: [{ name: "Marks", extensions: ["json"] }],
      });
      if (!picked) return;
      await fsWriteTextAbs(picked, JSON.stringify(archive, null, 2));
      setMarksStatus({
        kind: "ok",
        message: `Exported ${archive.marks.length} marks to ${picked}`,
      });
    } catch (err) {
      setMarksStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not export marks.",
      });
    }
  }

  async function onImportMarks(): Promise<void> {
    if (!paperReady || !paperId || !activePaper) return;
    setMarksStatus({ kind: "idle" });
    try {
      const picked = await open({ filters: [{ name: "Marks", extensions: ["json"] }] });
      if (typeof picked !== "string") return;
      const text = await readTextFile(picked);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setMarksStatus({ kind: "error", message: "Not valid JSON." });
        return;
      }
      const parsed = parseMarksArchive(raw);
      if (!parsed.ok) {
        setMarksStatus({ kind: "error", message: parsed.error });
        return;
      }
      const archive = parsed.archive;
      const revisions = await repo.revisions.listForPaper(paperId);
      const latest = revisions[revisions.length - 1];
      if (!latest) {
        setMarksStatus({ kind: "error", message: "Paper has no revision yet." });
        return;
      }
      const reanchor = reanchorProvider
        ? (mark: MarksArchiveMark) => reanchorProvider.reanchor(mark)
        : undefined;
      const { rows: importedRows, report } = await importMarksArchive({
        archive,
        targetRevisionId: latest.id,
        targetPdfSha256: activePaper.pdfSha256,
        targetFormat: activePaper.format,
        targetCategorySlugs: new Set(DEFAULT_CATEGORIES.map((c) => c.id)),
        ...(reanchor ? { reanchor } : {}),
        newId: () => crypto.randomUUID(),
      });
      await repo.annotations.bulkPut(latest.id, importedRows);
      await reviewStore.getState().load(latest.id);
      console.info("[ingest-marks]", {
        targetRevisionId: latest.id,
        sourceTitle: archive.document.title,
        sourceFormat: archive.document.format,
        targetFormat: activePaper.format,
        hashMatch: report.hashMatch,
        markCount: archive.marks.length,
        matched: report.matched,
        reanchored: report.reanchored,
        flagged: report.flagged,
        skipped: report.skipped,
        flaggedIds: report.flaggedIds,
        droppedIds: report.droppedIds,
        unknownCategories: report.unknownCategories,
      });
      setMarksStatus({ kind: "ok", message: report.message });
    } catch (err) {
      setMarksStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not import marks.",
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
          entrypoint: ctx.pdfFilename,
          sha256: paper.pdfSha256,
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
          entrypoint: ctx.pdfFilename,
          sha256: paper.pdfSha256,
        },
        annotations: ctx.annotations,
        ...(paper.rubric ? { rubric: { label: paper.rubric.label, body: paper.rubric.body } } : {}),
      });
      await writeText(text);
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
    await writeText(body);
    setDraftCopied(true);
    window.setTimeout(() => setDraftCopied(false), 1800);
  }

  const streaming = status.kind === "streaming";
  const hasBody = body.length > 0;

  if (!paperReady) {
    return (
      <section className="reviewer-actions" aria-label="Review">
        <p className="reviewer-actions__empty">Open a paper to begin.</p>
      </section>
    );
  }

  // MD papers only support the JSON bundle export today. The reviewer-letter
  // Claude flow and Markdown prompt export are PDF-specific (they rely on
  // page-number-anchored prompts).
  if (mdReady) {
    return (
      <section className="reviewer-actions" aria-label="Review">
        <RubricPanel paper={paperRowForRubric} />
        <p className="reviewer-actions__hint">
          Hand your marks to a coding agent as source patches. The bundle is format-agnostic — the
          plugin detects <code>.md</code> at run time.
        </p>
        <ExportChips
          onExportJSON={() => void onExportJSON()}
          onExportMarkdown={() => void onExportMarkdown()}
          onCopyPrompt={() => void onCopyPrompt()}
          onExportMarks={() => void onExportMarks()}
          onImportMarks={() => void onImportMarks()}
          state={exportState}
          marksStatus={marksStatus}
          mdOnly
        />
      </section>
    );
  }

  return (
    <section className="reviewer-actions" aria-label="Review">
      <header className="reviewer-actions__head">
        <h2 className="reviewer-actions__heading">Reviewer's letter</h2>
      </header>
      <RubricPanel paper={paperRowForRubric} />
      <p className="reviewer-actions__hint">
        {engineReady === true
          ? "Hand your marks to your AI engine for a journal-style reviewer's letter — draft it here, or copy the command and run it yourself."
          : engine.gate === "must-pick"
            ? "Pick an engine in Settings, or hand your marks off manually to any coding agent."
            : "Hand your marks to a coding agent and get back a journal-style reviewer's letter. Pick a handoff below."}
      </p>

      {engineReady === true ? (
        <EngineAction
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

      {engineReady === true ? (
        <p className="reviewer-actions__handoff-label">Or hand off manually</p>
      ) : null}

      <ExportChips
        onExportJSON={() => void onExportJSON()}
        onExportMarkdown={() => void onExportMarkdown()}
        onCopyPrompt={() => void onCopyPrompt()}
        onExportMarks={() => void onExportMarks()}
        onImportMarks={() => void onImportMarks()}
        state={exportState}
        marksStatus={marksStatus}
      />
    </section>
  );
}

interface ChipsProps {
  onExportJSON: () => void;
  onExportMarkdown: () => void;
  onCopyPrompt: () => void;
  onExportMarks: () => void;
  onImportMarks: () => void;
  state: ExportState;
  marksStatus: MarksStatus;
  mdOnly?: boolean;
}

function ExportChips({
  onExportJSON,
  onExportMarkdown,
  onCopyPrompt,
  onExportMarks,
  onImportMarks,
  state,
  marksStatus,
  mdOnly = false,
}: ChipsProps): JSX.Element {
  return (
    <fieldset className="reviewer-actions__chips" aria-label="Review output">
      <button type="button" className="reviewer-actions__chip" onClick={onExportJSON}>
        <span className="reviewer-actions__chip-label">JSON bundle</span>
        <span className="reviewer-actions__chip-hint">
          {state.kind === "json" ? state.relPath : "bundle-<ts>.json"}
        </span>
      </button>
      {!mdOnly ? (
        <>
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
        </>
      ) : null}
      <button type="button" className="reviewer-actions__chip" onClick={onExportMarks}>
        <span className="reviewer-actions__chip-label">Export marks</span>
        <span className="reviewer-actions__chip-hint">marks-&lt;ts&gt;.json</span>
      </button>
      <button type="button" className="reviewer-actions__chip" onClick={onImportMarks}>
        <span className="reviewer-actions__chip-label">Import marks</span>
        <span className="reviewer-actions__chip-hint">choose a file…</span>
      </button>
      {state.kind === "json" ? (
        <NextStep skill={mdOnly ? "apply-revision" : "write-review"} path={state.relPath} />
      ) : null}
      {state.kind === "error" ? (
        <p className="reviewer-actions__status" data-status="error">
          {state.message}
        </p>
      ) : null}
      {marksStatus.kind !== "idle" ? (
        <p className="reviewer-actions__status" data-status={marksStatus.kind}>
          {marksStatus.message}
        </p>
      ) : null}
    </fieldset>
  );
}

interface EngineActionProps {
  streaming: boolean;
  hasBody: boolean;
  body: string;
  outputRef: RefObject<HTMLDivElement | null>;
  onDraft: () => void;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCopyDraft: () => void;
  savedAt: string | null;
  copied: boolean;
  error: string | null;
}

function EngineAction({
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
}: EngineActionProps): JSX.Element {
  const progressStore = useWriteUpProgress();
  const writeupStore = useWriteUpStore();
  const phase = progressStore((s) => s.phase);
  const toolEvents = progressStore((s) => s.toolEvents);
  const assistantChars = progressStore((s) => s.assistantChars);
  const transcript = writeupStore((s) => s.transcript);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptRef = useRef<HTMLPreElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: transcript.length is the re-fire trigger so the effect follows content growth; the body reads el.scrollHeight live and doesn't need the numeric length.
  useEffect(() => {
    if (!transcriptOpen || !streaming) return;
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript.length, transcriptOpen, streaming]);

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
                Full output · {transcript.length.toLocaleString()} chars
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
                {transcript || "waiting for the engine…"}
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

type NextStepEngine = "claudeCode" | "openCode";

const NEXT_STEP_ENGINE_KEY = "obelus.exportEngine";

function readPersistedEngine(): NextStepEngine {
  try {
    const value = window.localStorage.getItem(NEXT_STEP_ENGINE_KEY);
    if (value === "openCode" || value === "claudeCode") return value;
  } catch {
    // localStorage unavailable — fall through to default
  }
  return "claudeCode";
}

function persistEngine(engine: NextStepEngine): void {
  try {
    window.localStorage.setItem(NEXT_STEP_ENGINE_KEY, engine);
  } catch {
    // ignore — selection is best-effort cross-session
  }
}

function nextStepCommand(
  skill: "write-review" | "apply-revision",
  path: string,
): Record<NextStepEngine, string> {
  return {
    claudeCode: `/${skill} ${path}`,
    openCode: `read .claude/skills/${skill}/SKILL.md and follow it on ${path}`,
  };
}

function NextStep({
  skill,
  path,
}: {
  skill: "write-review" | "apply-revision";
  path: string;
}): JSX.Element {
  const [engine, setEngine] = useState<NextStepEngine>(() => readPersistedEngine());
  const [copied, setCopied] = useState(false);
  const commands = nextStepCommand(skill, path);
  const command = commands[engine];
  const tabs: ReadonlyArray<{ id: NextStepEngine; label: string }> = [
    { id: "claudeCode", label: "Claude Code" },
    { id: "openCode", label: "OpenCode" },
  ];
  const onCopy = async (): Promise<void> => {
    await writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const onPickEngine = (id: NextStepEngine): void => {
    setEngine(id);
    persistEngine(id);
  };
  return (
    <div className="reviewer-actions__next">
      <div
        className="reviewer-actions__next-engines"
        role="tablist"
        aria-label="Choose your engine"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={engine === tab.id}
            tabIndex={engine === tab.id ? 0 : -1}
            className={`reviewer-actions__next-engine${
              engine === tab.id ? " reviewer-actions__next-engine--active" : ""
            }`}
            onClick={() => onPickEngine(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="reviewer-actions__next-label">
        {engine === "claudeCode"
          ? "Next: paste into a Claude Code session"
          : "Next: paste into an OpenCode session"}
      </p>
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
