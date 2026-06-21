import { diffLines } from "diff";
import type { JSX } from "react";

export type CodeRowKind = "context" | "removed" | "added";

export interface CodeRow {
  kind: CodeRowKind;
  text: string;
}

// jsdiff hands back runs whose `value` is one or more lines joined by "\n", each
// run ending in "\n" except possibly the last. Strip that single terminator
// before splitting so the trailing "" sentinel never becomes a phantom row.
function splitRunLines(value: string): string[] {
  const body = value.endsWith("\n") ? value.slice(0, -1) : value;
  return body.split("\n");
}

// Flatten a line-level diff into one row per line. A block that differs by a
// single line yields exactly one removed + one added row; everything else is
// quiet context — that contrast is the whole point of routing code here.
export function buildCodeRows(before: string, after: string): CodeRow[] {
  const rows: CodeRow[] = [];
  for (const part of diffLines(before, after)) {
    const kind: CodeRowKind = part.added ? "added" : part.removed ? "removed" : "context";
    for (const text of splitRunLines(part.value)) {
      rows.push({ kind, text });
    }
  }
  return rows;
}

function contextRows(lines: ReadonlyArray<string>): CodeRow[] {
  return lines.map((text) => ({ kind: "context" as const, text }));
}

// A zero-width space keeps an empty row's box height without inserting a real
// character; a bare empty string would collapse the line.
function renderText(text: string): string {
  return text === "" ? "​" : text;
}

export function CodeDiff({
  before,
  after,
  contextBefore,
  contextAfter,
}: {
  before: string;
  after: string;
  contextBefore: ReadonlyArray<string>;
  contextAfter: ReadonlyArray<string>;
}): JSX.Element {
  const rows = [
    ...contextRows(contextBefore),
    ...buildCodeRows(before, after),
    ...contextRows(contextAfter),
  ];
  return (
    <div className="diffview-code">
      {rows.map((row, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and identical lines recur within one block, so the index is the only stable key.
          key={`${i}:${row.kind}:${row.text}`}
          className={`diffview-code__row diffview-code__row--${row.kind}`}
        >
          {renderText(row.text)}
        </span>
      ))}
    </div>
  );
}
