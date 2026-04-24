import { MarkdownView, type MarkdownRenderStatus } from "@obelus/md-view";
import "@obelus/md-view/md.css";
import type { PaperRow } from "@obelus/repo";
import { getMdText, papers } from "@obelus/repo/web";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "./review-md.css";

import type { JSX } from "react";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; paper: PaperRow; file: string; text: string };

export default function ReviewMd(): JSX.Element {
  const { paperId } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!paperId) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const paper = await papers.get(paperId);
      if (!paper) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      if (paper.format !== "md") {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const text = await getMdText(paper.pdfSha256);
      if (text === null) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const file = paper.entrypointRelPath ?? `${paper.title || "paper"}.md`;
      if (!cancelled) setState({ kind: "ready", paper, file, text });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const onRender = useCallback((status: MarkdownRenderStatus) => {
    setRenderError(status.kind === "parse-failed" ? status.error.kind : null);
  }, []);

  if (state.kind === "loading") {
    return (
      <section className="review-md review-md--loading" aria-busy>
        <p>Opening paper…</p>
      </section>
    );
  }
  if (state.kind === "missing") {
    return (
      <section className="review-md review-md--missing" role="alert">
        <p>This paper is not available.</p>
        <Link to="/app" className="review-md__back">
          Back to library
        </Link>
      </section>
    );
  }

  return (
    <section className="review-md">
      <header className="review-md__header">
        <Link to="/app" className="review-md__back">
          &larr; Library
        </Link>
        <h1 className="review-md__title">{state.paper.title}</h1>
        {renderError !== null ? (
          <p className="review-md__render-error" role="alert">
            Markdown render failed: {renderError}
          </p>
        ) : null}
      </header>
      <div className="review-md__scroll">
        <MarkdownView file={state.file} text={state.text} onRender={onRender} />
      </div>
    </section>
  );
}
