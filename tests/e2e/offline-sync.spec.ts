/**
 * End-to-end test of the core offline-first promise: a user can type with
 * the network fully disabled, close/reopen the tab, and see their content
 * survive — then reconnect and have it sync to the server without loss.
 *
 * Run with: npx playwright test
 * Requires the app running locally (npm run dev) against a seeded test DB.
 */
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe("Offline-first editing", () => {
  test("edits persist locally while offline and sync on reconnect", async ({ page, context }) => {
    await login(page, "owner@example.com");
    await page.goto("/documents/test-doc-id");

    await context.setOffline(true);
    await expect(page.getByRole("status")).toContainText(/offline/i);

    const editor = page.getByLabel("Document content");
    await editor.click();
    await editor.fill("Written entirely offline.");

    // Reload the page while still offline — content must load from
    // IndexedDB, not from a network response.
    await page.reload();
    await expect(editor).toHaveValue("Written entirely offline.");

    await context.setOffline(false);
    await expect(page.getByRole("status")).toContainText(/synced|all changes saved/i, { timeout: 10_000 });
  });

  test("two collaborators editing concurrently offline both retain their content after reconnect", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await login(pageA, "owner@example.com");
    await login(pageB, "editor@example.com");

    await pageA.goto("/documents/test-doc-id");
    await pageB.goto("/documents/test-doc-id");

    await contextA.setOffline(true);
    await contextB.setOffline(true);

    await pageA.getByLabel("Document content").fill("Line from A.\n");
    await pageB.getByLabel("Document content").fill("Line from B.\n");

    await contextA.setOffline(false);
    await contextB.setOffline(false);

    // Give the debounced sync engine time to push + pull on both sides.
    await pageA.waitForTimeout(3000);
    await pageB.waitForTimeout(3000);
    await pageA.reload();

    const finalContent = await pageA.getByLabel("Document content").inputValue();
    expect(finalContent).toContain("Line from A.");
    expect(finalContent).toContain("Line from B.");

    await contextA.close();
    await contextB.close();
  });
});
