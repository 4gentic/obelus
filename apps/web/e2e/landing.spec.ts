import { expect, test } from "@playwright/test";
import { collectConsoleErrors, resetStorage } from "./fixtures/helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await resetStorage(page);
});

test.describe("landing page", () => {
  test("renders the hero and the two doors", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: /writing a paper with ai is cheap/i }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /review a paper\./i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /keep a writing desk\./i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open obelus/i })).toBeVisible();

    await expect.poll(() => errors.length, { message: errors.join("\n") }).toBe(0);
  });

  test("primary CTA navigates to /app", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /open obelus/i }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: /your library\./i })).toBeVisible();
  });

  test("honors the typesetter charter (no forbidden copy)", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/AI-powered/i);
    expect(body).not.toContain("✨");
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily.toLowerCase()).toMatch(/serif/);
  });
});
