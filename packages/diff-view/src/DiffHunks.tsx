import type { JSX } from "react";

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` header, when the source carries one. */
  header?: string;
  lines: DiffLine[];
}

export interface DiffFile {
  file: string;
  hunks: DiffHunk[];
}

export interface DiffHunksProps {
  files: ReadonlyArray<DiffFile>;
}

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: "diffview-line diffview-line--add",
  del: "diffview-line diffview-line--del",
  context: "diffview-line diffview-line--context",
};

const LINE_SIGIL: Record<DiffLineKind, string> = {
  add: "+",
  del: "-",
  context: " ",
};

function HunkLines({ lines }: { lines: ReadonlyArray<DiffLine> }): JSX.Element {
  return (
    <>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static per render and identical lines may repeat inside one hunk, so the index is the only stable key.
        <code key={`${i}:${line.text}`} className={LINE_CLASS[line.kind]}>
          <span className="diffview-line__sigil" aria-hidden="true">
            {LINE_SIGIL[line.kind]}
          </span>
          <span className="diffview-line__text">{line.text}</span>
        </code>
      ))}
    </>
  );
}

export function DiffHunks({ files }: DiffHunksProps): JSX.Element {
  return (
    <div className="diffview">
      {files.map((file) => (
        <article key={file.file} className="diffview-file">
          <header className="diffview-file__head">
            <span className="diffview-file__glyph" aria-hidden="true">
              ±
            </span>
            <span className="diffview-file__name">{file.file}</span>
          </header>
          {file.hunks.map((hunk, hi) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hunks are ordered and static per render; the header is optional and may repeat.
            <pre key={`${hi}:${hunk.header ?? ""}`} className="diffview-hunk">
              {hunk.header !== undefined && (
                <code className="diffview-line diffview-line--hunk">{hunk.header}</code>
              )}
              <HunkLines lines={hunk.lines} />
            </pre>
          ))}
        </article>
      ))}
    </div>
  );
}
