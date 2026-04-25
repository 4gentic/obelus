import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Download, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

export type PaperFormat = "pdf" | "md" | "html";
export type ExportTab = "review" | "revise";

export const MINIMAL_PDF_PATH = join(here, "minimal.pdf");
export const MINIMAL_PDF_QUOTE = "Obelus reviews offline.";

export const SAMPLE_MD_PATH = join(here, "sample.md");
// Whole-paragraph quote — triple-click on its `<p>` selects this exact text.
export const SAMPLE_MD_QUOTE =
  "On passkey retrieval, the linear variant underperforms dense by a wide margin: its recall drops to chance at sequence lengths above thirty thousand. On summarization, by contrast, it is indistinguishable from dense within our measurement noise. The block-sparse variant tracks dense on both tasks while using roughly half the attention FLOPs, which is the strongest result in our sweep.";

export const SAMPLE_HTML_PATH = join(here, "sample.html");
// Hand-authored HTML (no data-src markers) → selections produce `html` /
// `html-element` anchors, exercising the path that PDF and MD don't cover.
export const SAMPLE_HTML_QUOTE = "The margin is the place where reading becomes writing.";

interface FixtureSpec {
  readonly path: string;
  readonly quote: string;
  readonly title: string;
}

export const FIXTURES: Record<PaperFormat, FixtureSpec> = {
  pdf: { path: MINIMAL_PDF_PATH, quote: MINIMAL_PDF_QUOTE, title: "minimal" },
  md: { path: SAMPLE_MD_PATH, quote: SAMPLE_MD_QUOTE, title: "sample" },
  html: { path: SAMPLE_HTML_PATH, quote: SAMPLE_HTML_QUOTE, title: "sample" },
};

export async function resetStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("obelus");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    if ("storage" in navigator && "getDirectory" in navigator.storage) {
      try {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of (
          root as unknown as {
            entries(): AsyncIterable<[string, FileSystemHandle]>;
          }
        ).entries()) {
          try {
            await root.removeEntry(name, { recursive: true });
          } catch {}
        }
      } catch {}
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return errors;
}

// Force the anchor-download fallback. The native `showSaveFilePicker` opens
// a system dialog Playwright cannot dismiss; deleting the global routes every
// `saveBlob` call through `<a download>` instead.
export async function forceAnchorDownloads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });
}

export async function uploadAndOpen(page: Page, format: PaperFormat): Promise<void> {
  const fixture = FIXTURES[format];
  await page.goto("/app");
  await resetStorage(page);
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(fixture.path);
  await expect(page).toHaveURL(/\/app\/review\//);
  if (format === "pdf") {
    await expect(page.locator(".pdf-doc canvas").first()).toBeVisible();
    await expect(page.locator(".textLayer span").first()).toBeVisible();
  } else if (format === "md") {
    await expect(page.locator(".md-view")).toBeVisible();
    await expect(page.locator(".md-view p").first()).toBeVisible();
  } else {
    await expect(page.locator(".html-view__iframe")).toBeVisible();
    // Wait for the sandboxed srcdoc to parse and expose its body.
    await page.frameLocator(".html-view__iframe").locator("body").first().waitFor();
  }
}

interface SeedAnnotationOptions {
  category: string;
  note: string;
}

// Seeds a single annotation row directly into IndexedDB after upload, then
// reloads. Bypasses the rendered selection mechanism — which is exercised
// by the unit suites in `packages/{md,html,pdf}-view/__tests__/` and by the
// PDF e2e in `apps/web/e2e/review.spec.ts` — and lets this matrix focus on
// what the bundle / Markdown / clipboard buttons actually emit per format.
export async function seedAnnotation(
  page: Page,
  format: PaperFormat,
  { category, note }: SeedAnnotationOptions,
): Promise<void> {
  const quote = FIXTURES[format].quote;
  const ok = await page.evaluate(
    async ({ format, quote, category, note }) => {
      const url = new URL(window.location.href);
      const match = url.pathname.match(/\/app\/review\/([^/]+)/);
      if (!match) throw new Error(`not on /app/review/<id>: ${url.pathname}`);
      const paperId = match[1];

      const open: IDBOpenDBRequest = indexedDB.open("obelus");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error("open failed"));
      });

      const revisionId = await new Promise<string>((resolve, reject) => {
        const tx = db.transaction("revisions", "readonly");
        const store = tx.objectStore("revisions");
        const idx = store.index("paperId");
        const req = idx.getAll(paperId);
        req.onsuccess = () => {
          const rows = (req.result ?? []) as Array<{ id: string; revisionNumber: number }>;
          rows.sort((a, b) => b.revisionNumber - a.revisionNumber);
          const latest = rows[0];
          if (!latest) {
            reject(new Error(`no revision for paper ${paperId}`));
            return;
          }
          resolve(latest.id);
        };
        req.onerror = () => reject(req.error ?? new Error("revision lookup failed"));
      });

      const createdAt = new Date().toISOString();
      const id = crypto.randomUUID();

      // Build the right anchor shape per format. Pinning these here is the
      // whole point of the matrix — a regression that flips MD's anchor.kind
      // to anything other than "source" trips assertBundleShape downstream.
      let anchor: unknown;
      if (format === "pdf") {
        anchor = {
          kind: "pdf",
          page: 1,
          bbox: [50, 50, 250, 70],
          textItemRange: { start: [0, 0], end: [0, quote.length] },
        };
      } else if (format === "md") {
        anchor = {
          kind: "source",
          file: "sample.md",
          lineStart: 25,
          colStart: 0,
          lineEnd: 25,
          colEnd: quote.length,
        };
      } else {
        anchor = {
          kind: "html",
          file: "sample.html",
          xpath: "//blockquote/p",
          charOffsetStart: 0,
          charOffsetEnd: quote.length,
        };
      }

      const row = {
        id,
        revisionId,
        category,
        quote,
        contextBefore: "",
        contextAfter: "",
        anchor,
        note,
        thread: [],
        createdAt,
      };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("annotations", "readwrite");
        const store = tx.objectStore("annotations");
        const req = store.put(row);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("annotation put failed"));
      });
      return true;
    },
    { format, quote, category, note },
  );
  expect(ok).toBe(true);
  // Direct IDB writes don't fan out through Dexie's `liveQuery`. A reload
  // re-reads the table and the seeded row appears in the Marks tab.
  await page.reload();
  if (format === "pdf") {
    await expect(page.locator(".pdf-doc canvas").first()).toBeVisible();
  } else if (format === "md") {
    await expect(page.locator(".md-view")).toBeVisible();
  } else {
    await expect(page.locator(".html-view__iframe")).toBeVisible();
  }
  await expect(page.locator(".review-pane__item").first()).toBeVisible();
}

export async function openTab(page: Page, tab: ExportTab): Promise<Locator> {
  const label = tab === "review" ? "Review" : "Revise";
  await page.getByRole("tab", { name: label, exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: label });
  await expect(panel).toBeVisible();
  return panel;
}

export interface BundleShapeExpectation {
  paperTitle: string;
  category: string;
  quote: string;
  // The bundle's `annotations[0].anchor.kind`. PDFs always emit `pdf`; MD
  // (and paired-source HTML) emit `source`; hand-authored HTML emits `html`
  // for text selections and `html-element` for element clicks.
  anchorKind: "pdf" | "source" | "html" | "html-element";
}

interface ParsedBundle {
  bundleVersion?: unknown;
  tool?: { name?: unknown };
  papers?: ReadonlyArray<{ title?: unknown }>;
  annotations?: ReadonlyArray<{
    category?: unknown;
    quote?: unknown;
    anchor?: { kind?: unknown };
  }>;
}

export function assertBundleShape(parsed: ParsedBundle, expected: BundleShapeExpectation): void {
  expect(parsed).toMatchObject({
    bundleVersion: "1.0",
    tool: expect.objectContaining({ name: "obelus" }),
  });
  expect(Array.isArray(parsed.papers)).toBe(true);
  expect(parsed.papers?.[0]).toMatchObject({ title: expected.paperTitle });
  expect(Array.isArray(parsed.annotations)).toBe(true);
  expect((parsed.annotations ?? []).length).toBeGreaterThanOrEqual(1);
  const first = parsed.annotations?.[0];
  expect(first).toMatchObject({
    category: expected.category,
    quote: expected.quote,
    anchor: expect.objectContaining({ kind: expected.anchorKind }),
  });
}

export interface PromptShapeExpectation {
  paperTitle: string;
  category: string;
  quote: string;
}

// Pinned to the literal section headers emitted by
// `packages/prompts/src/formatters/format-review-prompt.ts`. The full text is
// snapshot-tested at the unit level — here we only verify the UI emitted a
// well-formed review prompt for *this* paper.
export function assertReviewPromptShape(text: string, expected: PromptShapeExpectation): void {
  expect(text).toContain(`# Review write-up for "${expected.paperTitle}"`);
  expect(text).toContain("## Voice");
  expect(text).toContain("## Output shape");
  expect(text).toContain("## Annotations");
  expect(text).toContain(expected.quote);
  expect(text).toContain(expected.category);
}

// Pinned to `format-fix-prompt.ts`. Distinct from the review prompt: starts
// `# Review for ...` (no "write-up"), instructs minimal-diff edits, and adds
// the "How to locate each passage" / "Edit shape by category" sections.
export function assertFixPromptShape(text: string, expected: PromptShapeExpectation): void {
  expect(text).toContain(`# Review for "${expected.paperTitle}"`);
  expect(text).toContain("## How to locate each passage");
  expect(text).toContain("## Edit shape by category");
  expect(text).toContain("## Annotations");
  expect(text).toContain(expected.quote);
  expect(text).toContain(expected.category);
}

export async function readDownloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
