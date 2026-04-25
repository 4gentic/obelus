import {
  type ClaudeStreamEvent,
  claudeAsk,
  claudeCancel,
  extractDeltaText,
  extractResultText,
  onClaudeExit,
  onClaudeStderr,
  onClaudeStdout,
  parseStreamLine,
} from "@obelus/claude-sidecar";
import { type JSX, useEffect, useRef, useState } from "react";
import { loadClaudeOverrides } from "../../lib/use-claude-defaults";
import { useAskStore } from "./ask-store-context";
import { buildAskPrompt } from "./build-ask-prompt";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import { useReviewStore } from "./store-context";

export default function AskPanel(): JSX.Element {
  const { project, rootId, repo } = useProject();
  const openPaper = useOpenPaper();
  const reviewStore = useReviewStore();
  const askStore = useAskStore();

  const threadId = askStore((s) => s.threadId);
  const messages = askStore((s) => s.messages);
  const status = askStore((s) => s.status);
  const selectedAnchor = reviewStore((s) => s.selectedAnchor);
  const draftCategory = reviewStore((s) => s.draftCategory);

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The paper id changes as the user opens different PDFs; the thread is
  // scoped per (project, paper). When no paper is open we fall back to the
  // project-only thread.
  const paperId = openPaper.kind === "ready" ? openPaper.paper.id : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const thread = await repo.askThreads.getOrCreate(project.id, paperId);
      if (cancelled) return;
      await askStore.getState().load(thread.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, project.id, paperId, askStore]);

  useEffect(() => {
    let unlistenStdout: (() => void) | undefined;
    let unlistenStderr: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    const matchSession = (sid: string): boolean => {
      const s = askStore.getState().status;
      return s.kind === "streaming" && s.claudeSessionId === sid;
    };

    void onClaudeStdout((ev: ClaudeStreamEvent) => {
      if (!matchSession(ev.sessionId)) return;
      const parsed = parseStreamLine(ev.line);
      if (!parsed) return;
      const result = extractResultText(parsed);
      if (result !== null) {
        // Final authoritative message — prefer it over accumulated deltas.
        const current = askStore.getState();
        const s = current.status;
        if (s.kind !== "streaming") return;
        const msgs = current.messages;
        const target = msgs.find((m) => m.id === s.assistantId);
        if (!target) return;
        askStore.setState({
          messages: msgs.map((m) => (m.id === s.assistantId ? { ...m, body: result } : m)),
        });
        return;
      }
      const delta = extractDeltaText(parsed);
      if (delta) askStore.getState().appendChunk(delta);
    }).then((fn) => {
      unlistenStdout = fn;
    });

    void onClaudeStderr((ev: ClaudeStreamEvent) => {
      // Claude --print writes status lines to stderr; we ignore them in the
      // transcript. Errors surface via the non-zero exit code.
      void ev;
    }).then((fn) => {
      unlistenStderr = fn;
    });

    void onClaudeExit((ev) => {
      if (!matchSession(ev.sessionId)) return;
      if (ev.cancelled) {
        void askStore.getState().finishAssistant({ cancelled: true });
        return;
      }
      if (ev.code !== 0) {
        void askStore.getState().failAssistant(`Claude exited with code ${ev.code ?? "?"}.`);
        return;
      }
      void askStore.getState().finishAssistant();
    }).then((fn) => {
      unlistenExit = fn;
    });

    return () => {
      unlistenStdout?.();
      unlistenStderr?.();
      unlistenExit?.();
    };
  }, [askStore]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length === 0 && status.kind !== "streaming") return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  async function submit(): Promise<void> {
    const question = draft.trim();
    if (!question || !threadId || status.kind === "streaming") return;
    setDraft("");

    const recent = askStore.getState().messages.map((m) => ({ role: m.role, body: m.body }));
    const promptBody = buildAskPrompt({
      projectLabel: project.label,
      projectRoot: project.root,
      openPaperRelPath: openPaper.kind === "ready" ? openPaper.path : null,
      selectedQuote: selectedAnchor
        ? {
            quote: selectedAnchor.quote,
            ...(draftCategory !== null ? { category: draftCategory } : {}),
          }
        : null,
      recent,
      question,
    });

    try {
      await askStore.getState().appendUser(question);
      const overrides = await loadClaudeOverrides();
      const claudeSessionId = await claudeAsk({
        rootId,
        projectId: project.id,
        promptBody,
        model: overrides.model,
        effort: overrides.effort,
      });
      await askStore.getState().startAssistant(claudeSessionId);
    } catch (err) {
      await askStore
        .getState()
        .failAssistant(err instanceof Error ? err.message : "Could not reach Claude.");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  async function cancel(): Promise<void> {
    if (status.kind !== "streaming") return;
    await claudeCancel(status.claudeSessionId);
  }

  const scope = openPaper.kind === "ready" ? `${project.label} · ${openPaper.path}` : project.label;

  return (
    <div className="ask-panel">
      <div className="ask-panel__thread" ref={scrollRef}>
        {messages.length === 0 && status.kind !== "streaming" ? (
          <div className="ask-panel__empty">
            <p>Ask anything about this project.</p>
            <p>Claude reads, never writes — for changes use the diff.</p>
          </div>
        ) : (
          messages.map((m) => (
            <article key={m.id} className={`ask-msg ask-msg--${m.role}`}>
              <header className="ask-msg__role">{m.role === "user" ? "you" : "claude"}</header>
              <div className="ask-msg__body">
                {m.body || (
                  <span className="ask-msg__placeholder">
                    {status.kind === "streaming" && status.assistantId === m.id
                      ? "Claude is reading. First words in a moment."
                      : m.cancelled
                        ? "(cancelled)"
                        : ""}
                  </span>
                )}
              </div>
            </article>
          ))
        )}
        {status.kind === "error" ? <p className="ask-panel__error">{status.message}</p> : null}
      </div>

      <form
        className="ask-panel__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="ask-panel__scope" title={project.root}>
          {scope}
        </p>
        <textarea
          ref={inputRef}
          className="ask-panel__input"
          placeholder="Ask anything about this project."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={!threadId}
        />
        <div className="ask-panel__actions">
          <span className="ask-panel__hint">⌘↵ to send</span>
          {status.kind === "streaming" ? (
            <button type="button" className="btn btn--subtle" onClick={() => void cancel()}>
              ⌫ cancel
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!threadId || draft.trim().length === 0}
            >
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
