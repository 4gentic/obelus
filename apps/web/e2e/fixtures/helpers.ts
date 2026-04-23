import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

export const MINIMAL_PDF_PATH = join(here, "minimal.pdf");
export const MINIMAL_PDF_QUOTE = "Obelus reviews offline.";

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
