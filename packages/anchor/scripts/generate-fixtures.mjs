// Regenerates the PDF fixtures used by roundtrip.test.ts.
// Run manually: `pnpm -C packages/anchor exec node scripts/generate-fixtures.mjs`
// The resulting PDFs are committed; CI does NOT run this script.
//
// Fixtures stay intentionally small (text-only, one standard font) so pdfjs-dist
// emits predictable TextItems that exercise:
//   - multi-item lines (font boundaries forced by pdf-lib into separate strings)
//   - explicit line breaks (hasEOL signal)
//   - ligatures decoded inside normalizeQuote (e.g. "official" with fi ligature)

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "fixtures");

async function simple() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const page = pdf.addPage([400, 300]);
  const size = 14;
  const lineHeight = 20;
  let y = 260;
  const lines = [
    "Obelus marks what the reader doubts.",
    "Writing AI papers is cheap.",
    "Reviewing them is the work.",
    "Claude applies the edits to your source.",
  ];
  for (const line of lines) {
    page.drawText(line, { x: 40, y, size, font });
    y -= lineHeight;
  }
  return await pdf.save();
}

const bytes = await simple();
await writeFile(resolve(outDir, "simple.pdf"), bytes);
process.stdout.write(`wrote ${bytes.byteLength} bytes to fixtures/simple.pdf\n`);
