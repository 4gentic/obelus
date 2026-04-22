export type DiffLineKind = "header" | "ctx" | "old" | "new";

export interface DiffDisplayLine {
  kind: DiffLineKind;
  text: string;
}

interface HunkHeader {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  raw: string;
}

const HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunkHeader(line: string): HunkHeader | null {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  const oldStart = Number(m[1]);
  const oldCount = m[2] === undefined ? 1 : Number(m[2]);
  const newStart = Number(m[3]);
  const newCount = m[4] === undefined ? 1 : Number(m[4]);
  if (!Number.isFinite(oldStart) || !Number.isFinite(newStart)) return null;
  return { oldStart, oldCount, newStart, newCount, raw: line };
}

function classifyBodyLine(raw: string): DiffLineKind {
  if (raw.startsWith("-") && !raw.startsWith("---")) return "old";
  if (raw.startsWith("+") && !raw.startsWith("+++")) return "new";
  return "ctx";
}

export function buildDisplayLines(
  patch: string,
  sourceText: string | null,
  pad: number,
): DiffDisplayLine[] {
  if (patch === "") return [];
  const lines = patch.split("\n");
  const last = lines.at(-1);
  const trimmed = last === "" ? lines.slice(0, -1) : lines;

  let header: HunkHeader | null = null;
  let bodyStart = 0;
  if (trimmed[0] !== undefined) {
    const h = parseHunkHeader(trimmed[0]);
    if (h) {
      header = h;
      bodyStart = 1;
    }
  }

  const body = trimmed.slice(bodyStart);

  if (header === null || sourceText === null || pad <= 0) {
    const out: DiffDisplayLine[] = [];
    if (header !== null) out.push({ kind: "header", text: header.raw });
    for (const raw of body) out.push({ kind: classifyBodyLine(raw), text: raw });
    return out;
  }

  const src = sourceText.split("\n");
  const oldStartIdx = header.oldStart - 1;
  const beforeFrom = Math.max(0, oldStartIdx - pad);
  const beforeTo = oldStartIdx;
  const afterFrom = oldStartIdx + header.oldCount;
  const afterTo = Math.min(src.length, afterFrom + pad);

  const out: DiffDisplayLine[] = [];
  const expandedOldStart = beforeFrom + 1;
  const expandedOldCount = beforeTo - beforeFrom + header.oldCount + (afterTo - afterFrom);
  const expandedNewStart = Math.max(1, header.newStart - (beforeTo - beforeFrom));
  const expandedNewCount = beforeTo - beforeFrom + header.newCount + (afterTo - afterFrom);
  out.push({
    kind: "header",
    text: `@@ -${expandedOldStart},${expandedOldCount} +${expandedNewStart},${expandedNewCount} @@`,
  });
  for (let i = beforeFrom; i < beforeTo; i++) {
    out.push({ kind: "ctx", text: ` ${src[i] ?? ""}` });
  }
  for (const raw of body) {
    out.push({ kind: classifyBodyLine(raw), text: raw });
  }
  for (let i = afterFrom; i < afterTo; i++) {
    out.push({ kind: "ctx", text: ` ${src[i] ?? ""}` });
  }
  return out;
}
