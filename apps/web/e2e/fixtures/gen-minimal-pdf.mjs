#!/usr/bin/env node
// Generates a minimal single-page PDF with a known text quote.
// Committed output lives next to this script; re-run only if we need to
// change the quote.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = dirname(fileURLToPath(import.meta.url));
const QUOTE = "Obelus reviews offline.";

function buildPdf(quote) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  const pageId = add(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const streamBody = `BT /F1 24 Tf 72 720 Td (${quote}) Tj ET`;
  const contentsId = add(`<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream`);

  if (catalogId !== 1 || pagesId !== 2 || pageId !== 3 || fontId !== 4 || contentsId !== 5) {
    throw new Error("object id allocation drifted from the hand-coded refs");
  }

  const header = "%PDF-1.4\n%âãÏÓ\n";
  let body = "";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(header.length + body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, "binary");
}

const pdf = buildPdf(QUOTE);
const outPath = join(outDir, "minimal.pdf");
writeFileSync(outPath, pdf);
process.stdout.write(`wrote ${outPath} (${pdf.length} bytes)\n`);
