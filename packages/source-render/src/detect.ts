import type { Spawner } from "./spawner.js";

// In preference order: tex4ht-class binaries (good fidelity, real LaTeX
// resolver) → pandoc (broad-but-shallow LaTeX subset). Pandoc is the
// fallback because it doesn't run a LaTeX engine — it interprets a subset
// of macros directly, so packages and custom \newcommand often don't render.
export const LATEX_BINARIES = ["make4ht", "htlatex", "pandoc"] as const;
export type LatexBinary = (typeof LATEX_BINARIES)[number];

export type LatexDetection =
  | { ok: true; bin: LatexBinary; resolvedPath: string }
  | { ok: false; tried: ReadonlyArray<LatexBinary> };

export async function detectLatexBinary(spawner: Spawner): Promise<LatexDetection> {
  for (const bin of LATEX_BINARIES) {
    const resolvedPath = await spawner.which(bin);
    if (resolvedPath !== null) {
      return { ok: true, bin, resolvedPath };
    }
  }
  return { ok: false, tried: LATEX_BINARIES };
}
