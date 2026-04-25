// Decides whether an incoming HTML paper is paired with a source file (in
// which case selections emit a SourceAnchor against that source) or whether
// it's hand-authored (HtmlAnchor with XPath). The decision is made once at
// ingest and threaded through the adapter via the `mode` prop.

const PAIRED_SOURCE_EXTS: ReadonlyArray<string> = [".md", ".tex", ".typ"];

export type ClassifyInput = {
  html: string;
  siblingPaths: ReadonlyArray<string>;
  // Bundle-relative path of the HTML file being classified. Used to look up
  // a sibling source file with the same basename.
  file: string;
};

export type ClassifyResult = { mode: "source"; sourceFile: string } | { mode: "html" };

function basenameWithoutExt(path: string): string {
  const slash = path.lastIndexOf("/");
  const tail = slash === -1 ? path : path.slice(slash + 1);
  const dot = tail.lastIndexOf(".");
  return dot === -1 ? tail : tail.slice(0, dot);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function findFirstDataSrcFile(html: string): string | null {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const tagged = parsed.querySelector("[data-src-file]");
  if (!tagged) return null;
  return tagged.getAttribute("data-src-file");
}

function findSiblingSource(file: string, siblingPaths: ReadonlyArray<string>): string | null {
  const targetBase = basenameWithoutExt(file);
  const targetDir = dirname(file);
  for (const ext of PAIRED_SOURCE_EXTS) {
    for (const sibling of siblingPaths) {
      if (sibling === file) continue;
      if (dirname(sibling) !== targetDir) continue;
      if (basenameWithoutExt(sibling) !== targetBase) continue;
      if (sibling.toLowerCase().endsWith(ext)) return sibling;
    }
  }
  return null;
}

export function classifyHtml(input: ClassifyInput): ClassifyResult {
  const dataSrcFile = findFirstDataSrcFile(input.html);
  const blockCount = countTaggedBlocks(input.html);
  if (dataSrcFile !== null) {
    const result: ClassifyResult = { mode: "source", sourceFile: dataSrcFile };
    logIngest(input.file, result, blockCount, true);
    return result;
  }
  const sibling = findSiblingSource(input.file, input.siblingPaths);
  if (sibling !== null) {
    const result: ClassifyResult = { mode: "source", sourceFile: sibling };
    logIngest(input.file, result, blockCount, false);
    return result;
  }
  const result: ClassifyResult = { mode: "html" };
  logIngest(input.file, result, blockCount, false);
  return result;
}

function countTaggedBlocks(html: string): number {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.querySelectorAll("[data-src-file]").length;
}

function logIngest(
  file: string,
  result: ClassifyResult,
  blockCount: number,
  hasDataSrc: boolean,
): void {
  console.info("[ingest-html]", {
    file,
    mode: result.mode,
    ...(result.mode === "source" ? { sourceFile: result.sourceFile } : {}),
    blockCount,
    hasData_src: hasDataSrc,
  });
}
