import { diffArrays } from "diff";
import type { JSX } from "react";
import { CodeDiff } from "./CodeDiff";
import { parseChange } from "./change-model";
import { type DiffRun, isHeavyRewrite, looksLikeCode } from "./classify";
import { tokenizeRich } from "./tokenize";

function Context({
  lines,
  place,
}: {
  lines: string[];
  place: "before" | "after";
}): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <span className={`diffview-inline__context diffview-inline__context--${place}`}>
      {lines.join("\n")}
    </span>
  );
}

// Math spans and markup calls are diffed as whole tokens, so a reworded formula
// reads as the old formula struck and the new one added rather than a scramble
// of `$`, identifiers, and parens aligned against unrelated prose.
function runsFor(before: string, after: string): readonly DiffRun[] {
  return diffArrays(tokenizeRich(before), tokenizeRich(after));
}

// Inline track-changes: one flow, removed struck and added underlined in place.
function Redline({ runs }: { runs: readonly DiffRun[] }): JSX.Element {
  return (
    <>
      {runs.map((run, i) => {
        const text = run.value.join("");
        if (run.added === true) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional and identical text may repeat within one change, so the index is the only stable key.
            <ins key={`${i}:${text}`} className="diffview-inline__ins">
              {text}
            </ins>
          );
        }
        if (run.removed === true) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            <del key={`${i}:${text}`} className="diffview-inline__del">
              {text}
            </del>
          );
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: see above.
        return <span key={`${i}:${text}`}>{text}</span>;
      })}
    </>
  );
}

// The resulting text, clean and unmarked — the readable payoff under the inline
// track-changes. Shown only for a heavy rewrite, where reading the new text
// through the marks is the hard part.
function FinalText({ text }: { text: string }): JSX.Element {
  return (
    <div className="diffview-final">
      <span className="diffview-final__label">Result</span>
      <p className="diffview-final__text">{text}</p>
    </div>
  );
}

export function InlineChange({
  patch,
  sourceText,
}: {
  patch: string;
  sourceText: string | null;
}): JSX.Element {
  const change = parseChange(patch, sourceText);
  if (change === null) {
    return <p className="diffview-inline__empty">No change to show.</p>;
  }

  if (looksLikeCode(change.before, change.after)) {
    return (
      <CodeDiff
        before={change.before}
        after={change.after}
        contextBefore={change.contextBefore}
        contextAfter={change.contextAfter}
      />
    );
  }

  const runs = runsFor(change.before, change.after);
  const redline = (
    <p className="diffview-inline">
      <Context lines={change.contextBefore} place="before" />
      <Redline runs={runs} />
      <Context lines={change.contextAfter} place="after" />
    </p>
  );

  if (isHeavyRewrite(runs)) {
    return (
      <>
        {redline}
        <FinalText text={change.after} />
      </>
    );
  }

  return redline;
}
