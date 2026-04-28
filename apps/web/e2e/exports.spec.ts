import { type Download, expect, test } from "@playwright/test";
import {
  assertBundleShape,
  assertFixPromptShape,
  assertReviewPromptShape,
  type BundleShapeExpectation,
  type ExportTab,
  FIXTURES,
  forceAnchorDownloads,
  openTab,
  type PaperFormat,
  readDownloadText,
  seedAnnotation,
  uploadAndOpen,
} from "./fixtures/helpers";

const CATEGORY = "elaborate";
const NOTE = "Needs a rewrite.";

interface FormatExpectation {
  format: PaperFormat;
  // The bundle's annotations[0].anchor.kind for this paper. Pinned per format
  // so a regression that flips MD's anchor to "pdf" (etc.) trips immediately.
  anchorKind: BundleShapeExpectation["anchorKind"];
}

const MATRIX: ReadonlyArray<FormatExpectation> = [
  { format: "pdf", anchorKind: "pdf" },
  { format: "md", anchorKind: "source" },
  { format: "html", anchorKind: "html" },
];

function describeFormat(label: string): string {
  return label.toUpperCase();
}

function downloadFilenamePattern(tab: ExportTab, ext: "json" | "md"): RegExp {
  return new RegExp(`^obelus-${tab}-.*\\.${ext}$`);
}

test.describe.configure({ mode: "serial" });

for (const { format, anchorKind } of MATRIX) {
  test.describe(`${describeFormat(format)} exports`, () => {
    test.beforeEach(async ({ page }) => {
      // Force the anchor-download fallback on every test in the matrix —
      // the system file picker would block the run otherwise. The test
      // bodies still register `page.on("download", ...)` and read the body
      // through `download.createReadStream()`.
      await forceAnchorDownloads(page);
      await uploadAndOpen(page, format);
      await seedAnnotation(page, format, { category: CATEGORY, note: NOTE });
    });

    for (const tab of ["review", "revise"] as const satisfies readonly ExportTab[]) {
      test(`${tab}: JSON bundle download`, async ({ page }) => {
        const panel = await openTab(page, tab);
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          panel.getByRole("button", { name: /json bundle/i }).click(),
        ]);
        expect(download.suggestedFilename()).toMatch(downloadFilenamePattern(tab, "json"));
        const parsed = JSON.parse(await readDownloadText(download));
        assertBundleShape(parsed, {
          paperTitle: FIXTURES[format].title,
          category: CATEGORY,
          quote: FIXTURES[format].quote,
          anchorKind,
        });
      });

      test(`${tab}: Markdown bundle download`, async ({ page }) => {
        const panel = await openTab(page, tab);
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          panel.getByRole("button", { name: /^markdown\b/i }).click(),
        ]);
        expect(download.suggestedFilename()).toMatch(downloadFilenamePattern(tab, "md"));
        const text = await readDownloadText(download);
        const expectations = {
          paperTitle: FIXTURES[format].title,
          category: CATEGORY,
          quote: FIXTURES[format].quote,
        };
        if (tab === "review") {
          assertReviewPromptShape(text, expectations);
        } else {
          assertFixPromptShape(text, expectations);
        }
      });

      test(`${tab}: Copy to clipboard lands inline, not as a file`, async ({ page }) => {
        const panel = await openTab(page, tab);
        // Inline-not-file regression guard. If a future change swaps
        // `navigator.clipboard.writeText` for an `<a download>` fallback
        // (the user's reported regression), this listener will collect the
        // download and the assertion below will fail.
        const downloads: Download[] = [];
        page.on("download", (d) => downloads.push(d));
        await panel.getByRole("button", { name: /copy to clipboard/i }).click();
        const expectedMessage =
          tab === "review" ? /review prompt copied/i : /prompt copied to clipboard/i;
        await expect(panel.locator(".review-pane__status")).toContainText(expectedMessage);
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        const expectations = {
          paperTitle: FIXTURES[format].title,
          category: CATEGORY,
          quote: FIXTURES[format].quote,
        };
        if (tab === "review") {
          assertReviewPromptShape(clip, expectations);
        } else {
          assertFixPromptShape(clip, expectations);
        }
        expect(
          downloads,
          "Copy must land inline; a file download means the regression returned",
        ).toHaveLength(0);
      });
    }
  });
}
