// One block-level element in the rendered HTML, mapped back to its source
// position. `colStart`/`colEnd` are 0-indexed to match SourceAnchor's
// `nonnegative` constraint; `line` is 1-indexed (mdast/typst convention).
export type SourceMapBlock = {
  line: number;
  colStart: number;
  colEnd: number;
};

export type SourceMap = {
  file: string;
  blocks: ReadonlyArray<SourceMapBlock>;
};

export type RenderError =
  | {
      kind: "binary-missing";
      tried: ReadonlyArray<string>;
    }
  | {
      kind: "render-failed";
      stderr: string;
      exitCode: number;
    }
  | {
      kind: "parse-failed";
      message: string;
    }
  | {
      kind: "unsupported";
      message: string;
    };

export type RenderResult =
  | { ok: true; html: string; sourceMap: SourceMap }
  | { ok: false; error: RenderError };
