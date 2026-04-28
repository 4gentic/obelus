import { expect, test } from "@playwright/test";
import {
  collectConsoleErrors,
  MINIMAL_PDF_PATH,
  MINIMAL_PDF_QUOTE,
  resetStorage,
} from "./fixtures/helpers";

async function uploadAndOpen(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app");
  await resetStorage(page);
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(MINIMAL_PDF_PATH);
  await expect(page).toHaveURL(/\/app\/review\//);
  await expect(page.locator(".pdf-doc canvas").first()).toBeVisible();
  await expect(page.locator(".textLayer span").first()).toBeVisible();
}

async function selectQuote(page: import("@playwright/test").Page): Promise<void> {
  // Triple-click the text-layer span to select the whole visible line.
  // SelectionListener consumes this as a "no-drag" gesture and resolves the
  // anchor from the native DOM Range (the fallback path), which works
  // reliably in headless Chromium even when pixel-level drags are flaky.
  const span = page.locator(".textLayer span", { hasText: MINIMAL_PDF_QUOTE }).first();
  await span.click({ clickCount: 3 });
  await expect(page.getByText(/draft · unsaved/i)).toBeVisible();
}

test.describe("review", () => {
  test("pdf renders with a text layer", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await uploadAndOpen(page);

    const box = await page.locator(".pdf-doc canvas").first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);

    await expect(
      page.locator(".textLayer span", { hasText: MINIMAL_PDF_QUOTE }).first(),
    ).toBeVisible();

    // PDF worker and font warnings are benign; only fail on unexpected errors.
    const unexpected = errors.filter(
      (e) => !/standard[_ ]?font|workerSrc|Worker was destroyed/i.test(e),
    );
    expect(unexpected, unexpected.join("\n")).toEqual([]);
  });

  test("selecting text drafts an annotation; saving it lands in Marks", async ({ page }) => {
    await uploadAndOpen(page);
    await selectQuote(page);

    await page
      .locator("label.catpick__chip")
      .filter({ hasText: /^elaborate$/i })
      .click();
    await page.getByRole("textbox", { name: /what needs attention/i }).fill("Needs a rewrite.");
    await page.getByRole("button", { name: "Save mark" }).click();

    await expect(page.getByText(/draft · unsaved/i)).not.toBeVisible();

    const firstItem = page.locator(".review-pane__item").first();
    await expect(firstItem).toBeVisible();
    await expect(firstItem).toHaveAttribute("data-category", "elaborate");
    await expect(firstItem).toContainText(MINIMAL_PDF_QUOTE);
    await expect(page.locator(".review-shell__hl").first()).toBeVisible();

    const tabCount = await page
      .locator("#review-pane-tab-marks .review-pane__tab-count")
      .innerText();
    expect(Number(tabCount)).toBeGreaterThanOrEqual(1);
  });

  test("annotation and title edits persist across reload", async ({ page }) => {
    await uploadAndOpen(page);
    await selectQuote(page);

    await page
      .locator("label.catpick__chip")
      .filter({ hasText: /^weak argument$/i })
      .click();
    await page.getByRole("textbox", { name: /what needs attention/i }).fill("Original note.");
    await page.getByRole("button", { name: "Save mark" }).click();

    await expect(page.locator(".review-pane__item").first()).toHaveAttribute(
      "data-category",
      "weak-argument",
    );

    // Rename the paper via the breadcrumb.
    await page.getByRole("button", { name: /rename minimal/i }).click();
    const titleInput = page.getByRole("textbox", { name: "Paper title" });
    await titleInput.fill("Reloaded Paper");
    await titleInput.press("Enter");
    await expect(page.getByRole("button", { name: /rename reloaded paper/i })).toBeVisible();

    await page.reload();
    await expect(page.locator(".pdf-doc canvas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /rename reloaded paper/i })).toBeVisible();
    await expect(page.locator(".review-pane__item").first()).toHaveAttribute(
      "data-category",
      "weak-argument",
    );
    await expect(page.locator(".review-pane__item").first()).toContainText("Original note.");
  });

  test("editing a saved mark's category recolors the highlight in place", async ({ page }) => {
    await uploadAndOpen(page);
    await selectQuote(page);

    await page
      .locator("label.catpick__chip")
      .filter({ hasText: /^elaborate$/i })
      .click();
    await page.getByRole("button", { name: "Save mark" }).click();

    const item = page.locator(".review-pane__item").first();
    await expect(item).toHaveAttribute("data-category", "elaborate");
    const highlight = page.locator(".review-shell__hl").first();
    await expect(highlight).toHaveAttribute("data-category", "elaborate");

    await item
      .locator("label.catpick__chip")
      .filter({ hasText: /^praise$/i })
      .click();

    await expect(item).toHaveAttribute("data-category", "praise");
    await expect(highlight).toHaveAttribute("data-category", "praise");
  });

  test("deleting an annotation removes it from the margin and the list", async ({ page }) => {
    await uploadAndOpen(page);
    await selectQuote(page);

    await page
      .locator("label.catpick__chip")
      .filter({ hasText: /^praise$/i })
      .click();
    await page.getByRole("button", { name: "Save mark" }).click();
    await expect(page.locator(".review-pane__item")).toHaveCount(1);

    await page
      .locator(".review-pane__item")
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.locator(".review-pane__item")).toHaveCount(0);
    await expect(page.locator(".review-shell__hl")).toHaveCount(0);
  });

  test("export review bundle: JSON download + clipboard copy", async ({ page }) => {
    // Force the anchor-download fallback; the File System Access picker opens
    // a native dialog Playwright cannot dismiss.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "showSaveFilePicker");
    });
    await uploadAndOpen(page);
    await selectQuote(page);
    await page
      .locator("label.catpick__chip")
      .filter({ hasText: /^elaborate$/i })
      .click();
    await page.getByRole("button", { name: "Save mark" }).click();
    await expect(page.locator(".review-pane__item")).toHaveCount(1);

    await page.getByRole("tab", { name: "Review" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /json bundle/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^obelus-review-.*\.json$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(parsed).toMatchObject({
      bundleVersion: "1.0",
      tool: expect.objectContaining({ name: "obelus" }),
    });
    expect(Array.isArray(parsed.papers)).toBe(true);
    expect(parsed.papers[0]).toMatchObject({ title: "minimal" });
    expect(Array.isArray(parsed.annotations)).toBe(true);
    expect(parsed.annotations.length).toBeGreaterThanOrEqual(1);
    expect(parsed.annotations[0]).toMatchObject({
      category: "elaborate",
      quote: MINIMAL_PDF_QUOTE,
      anchor: expect.objectContaining({ kind: "pdf" }),
    });

    await page.getByRole("button", { name: /copy to clipboard/i }).click();
    await expect(page.locator(".review-pane__status")).toContainText(/copied/i);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length).toBeGreaterThan(0);
    expect(clip).toContain(MINIMAL_PDF_QUOTE);
  });

  test("back navigation returns to the library with the paper", async ({ page }) => {
    await uploadAndOpen(page);
    await page.locator(".review-crumb__back").click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("listitem").filter({ hasText: "minimal" })).toBeVisible();
  });
});
