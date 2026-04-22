import type { PaperEditRow } from "@obelus/repo";
import { type JSX, useEffect, useState } from "react";
import type { DiffManifestsReport, FileDiff } from "../../ipc/commands";
import { historyDiffManifests } from "../../ipc/commands";
import { useProject } from "./context";

interface Props {
  from: PaperEditRow;
  to: PaperEditRow;
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; report: DiffManifestsReport }
  | { kind: "error"; message: string };

export default function CompareDrafts({ from, to, onClose }: Props): JSX.Element {
  const { rootId } = useProject();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const report = await historyDiffManifests({
          rootId,
          fromManifestSha: from.manifestSha256,
          toManifestSha: to.manifestSha256,
        });
        if (!cancelled) setState({ kind: "ready", report });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not load diff.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, from.manifestSha256, to.manifestSha256]);

  return (
    <section
      className="compare-drafts"
      aria-label={`Compare Draft ${from.ordinal} to Draft ${to.ordinal}`}
    >
      <header className="compare-drafts__head">
        <button type="button" className="compare-drafts__back" onClick={onClose}>
          ← drafts
        </button>
        <h3 className="compare-drafts__title">
          Draft {from.ordinal} → Draft {to.ordinal}
        </h3>
      </header>

      {state.kind === "loading" && <p className="compare-drafts__status">Reading manifests…</p>}
      {state.kind === "error" && (
        <p className="compare-drafts__status compare-drafts__status--err">{state.message}</p>
      )}
      {state.kind === "ready" && state.report.files.length === 0 && (
        <p className="compare-drafts__status">These two drafts have identical contents.</p>
      )}
      {state.kind === "ready" && state.report.files.length > 0 && (
        <ol className="compare-drafts__files">
          {state.report.files.map((file) => (
            <li key={file.rel} className="compare-drafts__file">
              <header className="compare-drafts__file-head">
                <span className="compare-drafts__file-path" title={file.rel}>
                  {file.rel}
                </span>
                <span
                  className={`compare-drafts__status-tag compare-drafts__status-tag--${file.status}`}
                >
                  {file.status}
                </span>
              </header>
              <FileBody file={file} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FileBody({ file }: { file: FileDiff }): JSX.Element {
  if (file.status === "binary") {
    return <p className="compare-drafts__binary">binary or non-UTF-8; not shown.</p>;
  }
  const hunks = parseUnifiedDiff(file.unified);
  if (hunks.length === 0) {
    return <p className="compare-drafts__binary">empty diff.</p>;
  }
  return (
    <div className="compare-drafts__hunks">
      {hunks.map((h, hi) => (
        <pre
          // biome-ignore lint/suspicious/noArrayIndexKey: hunks are stable per render and may legitimately share headers across edits.
          key={hi}
          className="diff-block__patch compare-drafts__hunk"
        >
          <div className="diff-line diff-line--hunk">{h.header}</div>
          {h.lines.map((line, li) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines may repeat inside a hunk; identity by position.
              key={`${hi}:${li}`}
              className={`diff-line diff-line--${line.kind}`}
            >
              {line.text}
            </div>
          ))}
        </pre>
      ))}
    </div>
  );
}

type Kind = "ctx" | "old" | "new";

interface Hunk {
  header: string;
  lines: Array<{ kind: Kind; text: string }>;
}

function parseUnifiedDiff(unified: string): Hunk[] {
  if (unified === "") return [];
  const lines = unified.split("\n");
  const last = lines.at(-1);
  const trimmed = last === "" ? lines.slice(0, -1) : lines;
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const raw of trimmed) {
    if (raw.startsWith("@@ ")) {
      if (current) hunks.push(current);
      current = { header: raw, lines: [] };
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) continue;
    if (!current) continue;
    if (raw.startsWith("-")) current.lines.push({ kind: "old", text: raw });
    else if (raw.startsWith("+")) current.lines.push({ kind: "new", text: raw });
    else current.lines.push({ kind: "ctx", text: raw });
  }
  if (current) hunks.push(current);
  return hunks;
}
