import { expect, test } from "@playwright/test";
import { collectConsoleErrors, MINIMAL_PDF_PATH, resetStorage } from "./fixtures/helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await resetStorage(page);
  await page.reload();
});

test.describe("library", () => {
  test("empty state prompts the first upload", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await expect(page.getByRole("heading", { name: /your library\./i })).toBeVisible();
    await expect(page.getByText(/no papers yet\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /open a paper/i })).toBeVisible();
    await expect(page.getByText(/PDF · Markdown · HTML/)).toBeVisible();
    await expect.poll(() => errors.length, { message: errors.join("\n") }).toBe(0);
  });

  test("upload → paper lands in library; survives reload", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(MINIMAL_PDF_PATH);
    await expect(page).toHaveURL(/\/app\/review\//);

    await page.locator(".review-crumb__back").click();
    await expect(page).toHaveURL(/\/app$/);

    const row = page.getByRole("listitem").filter({ hasText: "minimal" });
    await expect(row).toBeVisible();

    await page.reload();
    await expect(row).toBeVisible();
  });

  test("rename persists across reload", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(MINIMAL_PDF_PATH);
    await expect(page).toHaveURL(/\/app\/review\//);
    await page.locator(".review-crumb__back").click();

    await page.getByRole("button", { name: /rename minimal/i }).click();
    const input = page.getByRole("textbox", { name: "Paper title" });
    await input.fill("Renamed by test");
    await input.press("Enter");

    await expect(page.getByRole("link", { name: "Renamed by test" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: "Renamed by test" })).toBeVisible();
  });

  test("remove requires confirmation and empties the library", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(MINIMAL_PDF_PATH);
    await expect(page).toHaveURL(/\/app\/review\//);
    await page.locator(".review-crumb__back").click();

    await page.getByRole("button", { name: /^remove minimal/i }).click();
    await page.getByRole("button", { name: /confirm removal of minimal/i }).click();

    await expect(page.getByText(/no papers yet\./i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/no papers yet\./i)).toBeVisible();
  });

  test("rejects unsupported uploads with a visible error", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "not-supported.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });

    await expect(page.getByRole("alert")).toContainText(/supports \.pdf, \.md, and \.html/i);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(/no papers yet\./i)).toBeVisible();
  });
});
