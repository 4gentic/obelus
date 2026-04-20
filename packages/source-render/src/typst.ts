import type { RenderResult } from "./types.js";

// Typst rendering is stubbed in v1. Real integration belongs to the moment
// `apps/desktop` first opens a `.typ` file with a fixture available — only
// then can we validate the typst-ts-node-compiler API against an upstream
// HTML feature that is itself still experimental. Until then, returning
// `unsupported` lets the writer-mode UI render a clean RenderFailedPane.
export async function renderTypst(input: {
  file: string;
  text: string;
  rootDir: string;
}): Promise<RenderResult> {
  void input;
  return {
    ok: false,
    error: {
      kind: "unsupported",
      message:
        "Typst preview is not implemented yet. Open the file in your editor; the source bundle still works.",
    },
  };
}
