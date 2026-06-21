import type { JSX } from "react";
import { useState } from "react";
import type { TranscriptEntry } from "./review-progress-store";

function ThinkingLine({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="review-console__thinking">
      <p className="review-console__thinking-body" data-clamp={expanded ? undefined : ""}>
        {text}
      </p>
      <button
        type="button"
        className="review-console__thinking-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "⌃ hide reasoning" : "⌄ show reasoning"}
      </button>
    </li>
  );
}

function FeedLine({ entry }: { entry: TranscriptEntry }): JSX.Element {
  switch (entry.kind) {
    case "phase":
      return <li className="review-console__phase">{entry.label}</li>;
    case "note":
      return (
        <li className="review-console__note">
          <span className="review-console__note-mark" aria-hidden>
            —
          </span>{" "}
          {entry.text}
        </li>
      );
    case "thinking":
      return <ThinkingLine text={entry.text} />;
    case "tool":
      return (
        <li className="review-console__tool" data-error={entry.error ? "" : undefined}>
          <span aria-hidden>→</span> {entry.label}
          {entry.result ? (
            <span className="review-console__tool-res"> · {entry.result}</span>
          ) : null}
        </li>
      );
    case "assistant":
      return <li className="review-console__assistant">{entry.text}</li>;
  }
}

// Presentational render of the reviewer's live narration. The progress store
// owns all parsing and ordering; this only maps entry kinds to markup so both
// the running console and any future surface share one rendering. The
// transcript is append-only, so an index key is stable (except a rare trailing
// trim) and cheaper than minting ids the store would otherwise carry.
export default function ReviewFeed({ entries }: { entries: TranscriptEntry[] }): JSX.Element {
  return (
    <ol className="review-console__list">
      {entries.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript; positions are stable except a rare trailing trim.
        <FeedLine key={index} entry={entry} />
      ))}
    </ol>
  );
}
