import { formatReviewPrompt, type PromptAnnotation } from "@obelus/bundle-builder";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { fsWriteText } from "../../ipc/commands";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import RubricPanel from "./RubricPanel";
import { useWriteUpRunner } from "./writeup-store-context";

function slugify(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "writeup"
  );
}

function timestampForFilename(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export default function WriteUpPanel(): JSX.Element {
  const { project, repo, rootId } = useProject();
  const openPaper = useOpenPaper();
  const runner = useWriteUpRunner();
  const store = runner.store;

  const projectIdInStore = store((s) => s.projectId);
  const paperIdInStore = store((s) => s.paperId);
  const body = store((s) => s.body);
  const dirty = store((s) => s.dirty);
  const status = store((s) => s.status);

  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const paperId = openPaper.kind === "ready" ? openPaper.paper.id : null;
  const paperTitle = openPaper.kind === "ready" ? openPaper.paper.title : "";
  const paperReady = paperId !== null;

  useEffect(() => {
    if (!paperId) return;
    setSaved(null);
    setCopied(false);
    if (projectIdInStore === project.id && paperIdInStore === paperId) return;
    void store.getState().load(project.id, paperId);
  }, [project.id, paperId, projectIdInStore, paperIdInStore, store]);

  async function onDraft(): Promise<void> {
    if (!paperId) return;
    setSaved(null);
    await runner.beginDraft(paperId, paperTitle);
  }

  async function onCancel(): Promise<void> {
    await runner.cancelDraft();
  }

  async function onSaveToFolder(): Promise<void> {
    if (!paperId || openPaper.kind !== "ready") return;
    await store.getState().save();
    const pdfName = openPaper.path.split("/").pop() ?? "paper";
    const filename = `.obelus/writeup-${slugify(pdfName)}-${timestampForFilename()}.md`;
    await fsWriteText(rootId, filename, body);
    setSaved(filename);
  }

  async function onCopy(): Promise<void> {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function onCopyReviewPrompt(): Promise<void> {
    if (!paperId) return;
    setPromptError(null);
    try {
      const paper = await repo.papers.get(paperId);
      if (!paper) {
        setPromptError("Paper not found.");
        return;
      }
      const revisions = await repo.revisions.listForPaper(paperId);
      const latest = revisions[revisions.length - 1];
      if (!latest) {
        setPromptError("No revision for this paper.");
        return;
      }
      const rows = await repo.annotations.listForRevision(latest.id);
      if (rows.length === 0) {
        setPromptError("No marks on this paper.");
        return;
      }
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
      const filename = openPaper.kind === "ready" ? (openPaper.path.split("/").pop() ?? "") : "";
      const text = formatReviewPrompt({
        paper: {
          title: paperTitle || "Paper",
          revisionNumber: latest.revisionNumber,
          pdfFilename: filename,
          pdfSha256: paper.pdfSha256,
        },
        annotations,
        ...(paper.rubric ? { rubric: { label: paper.rubric.label, body: paper.rubric.body } } : {}),
      });
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1800);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Could not build review prompt.");
    }
  }

  const streaming = status.kind === "streaming";
  const hasBody = body.length > 0;
  const canDraft = paperReady && !streaming;

  return (
    <div className="writeup-panel">
      <header className="writeup-panel__head">
        {!paperReady ? (
          <p className="writeup-panel__scope">Open a paper to draft a write-up.</p>
        ) : (
          <p
            className="writeup-panel__scope"
            title={openPaper.kind === "ready" ? openPaper.path : ""}
          >
            {paperTitle || "Write-up"}
          </p>
        )}
        {streaming ? <span className="writeup-panel__marker">drafting…</span> : null}
      </header>

      <RubricPanel paper={openPaper.kind === "ready" ? openPaper.paper : null} />

      <div className="writeup-panel__body">
        {!hasBody && !streaming ? (
          <div className="writeup-panel__empty">
            <p>Draft a structured review from this paper's marks.</p>
            <p>Six sections, Markdown, nothing is sent anywhere.</p>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="writeup-panel__editor"
            value={body}
            readOnly={streaming}
            onChange={(e) => store.getState().setBody(e.target.value)}
            spellCheck={false}
            placeholder={streaming ? "Claude is reading your marks. First line in a moment." : ""}
          />
        )}
        {status.kind === "error" ? <p className="writeup-panel__error">{status.message}</p> : null}
      </div>

      <footer className="writeup-panel__foot">
        {streaming ? (
          <button type="button" className="btn btn--subtle" onClick={() => void onCancel()}>
            ⌫ cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canDraft}
            onClick={() => void onDraft()}
          >
            {hasBody ? "Re-draft" : "Draft the write-up"}
          </button>
        )}
        <button
          type="button"
          className="btn btn--subtle"
          disabled={!hasBody || streaming}
          onClick={() => void onSaveToFolder()}
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn--subtle"
          disabled={!hasBody || streaming}
          onClick={() => void onCopy()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="btn btn--subtle"
          disabled={!paperReady || streaming}
          onClick={() => void onCopyReviewPrompt()}
          title="Copy a self-contained Markdown prompt that asks any agent to generate this review."
        >
          {promptCopied ? "Copied prompt" : "Copy review prompt"}
        </button>
        {dirty && !streaming ? <span className="writeup-panel__hint">unsaved</span> : null}
        {saved ? <span className="writeup-panel__hint">Written to {saved}</span> : null}
        {promptError ? <span className="writeup-panel__hint">{promptError}</span> : null}
      </footer>
    </div>
  );
}
