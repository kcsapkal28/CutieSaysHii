// Walks the whole Studio against the MockBackend: Brief → Style Studio → Stages → Build → Viewer.
import { expect, test, type Page } from "@playwright/test";

async function approveStage(page: Page, stage: string, next: RegExp) {
  await expect(page).toHaveURL(new RegExp(`/${stage}$`));
  await expect(page.getByText("Ready for review").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Approve and continue/ }).click();
  await expect(page).toHaveURL(next);
}

test("brief → style → stages → build → viewer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Projects home
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
  await page.getByRole("link", { name: /New deck/ }).first().click();

  // Brief
  await expect(page).toHaveURL(/\/new$/);
  await page.getByLabel("What is the talk about?").fill("How active noise cancellation works in wireless earbuds");
  await page.getByLabel("Who’s in the room?").fill("Firmware engineers new to audio DSP");
  await page.getByLabel("What should they leave able to do?").fill("Explain feedforward vs feedback ANC.");
  await page.getByRole("button", { name: "Continue to style" }).click();

  // Style Studio: the engine-rendered preview loads, Recommend fills the controls, a palette click restyles it.
  await expect(page).toHaveURL(/\/p\/[^/]+\/style$/);
  const preview = page.frameLocator("iframe[title='Style preview']");
  await expect(preview.locator("#s01 .df-h1")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Recommend for my topic/ }).click();
  await expect(page.getByText("Why this style")).toBeVisible();
  await page.getByRole("radio", { name: /Deep ocean/ }).click();
  await expect
    .poll(async () => preview.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--df-accent").trim()))
    .toBe("#3ee0c5");
  await page.getByRole("button", { name: /Save and start research/ }).click();

  // Stages: each auto-runs on arrival, then gets approved.
  await approveStage(page, "research", /\/outline(\?run=1)?$/);

  // Outline: one card per slide with the words and the visual together; edit both in the same card.
  await page.waitForURL(/\/outline$/);
  await expect(page.getByText("Ready for review").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Agent activity").getByText(/Arc planned: 10 slides/)).toBeVisible();
  await expect(page.getByText("20:00").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("s01 point").fill("ANC makes sound to remove sound. Edited.");
  await page.getByLabel("s01 interaction kind").selectOption("click");
  await page.getByLabel("s01 interaction", { exact: true }).fill("Click the bud to explode it.");
  await page.getByRole("button", { name: /Done editing/ }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByText("ANC makes sound to remove sound. Edited.")).toBeVisible();
  await expect(page.getByText("click: Click the bud to explode it.")).toBeVisible();

  // Old stage URLs land on the outline.
  const id = /\/p\/([^/]+)\//.exec(page.url())![1];
  await page.goto(`/p/${id}/storyboard`);
  await expect(page).toHaveURL(/\/outline$/);
  await expect(page.getByRole("button", { name: /Approve and continue/ })).toBeEnabled();
  await page.getByRole("button", { name: /Approve and continue/ }).click();
  await expect(page).toHaveURL(/\/build(\?run=1)?$/);

  // Build: the filmstrip fills in, every slide passes.
  await expect(page.getByText("10/10")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("option").first()).toContainText("Passed");
  await page.getByRole("button", { name: /Approve and open deck/ }).click();

  // Viewer and refine
  await expect(page).toHaveURL(/\/deck$/);
  const deck = page.frameLocator("iframe[title$='v1']");
  await expect(deck.locator("#s01")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Editing slide").selectOption("s05");
  await page.getByLabel(/Describe a change to s05/).fill("Make the packets slower");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Saved as v2")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Download deck.html/ })).toHaveAttribute("href", /versions\/2\/deck\.html\?download=1/);

  // Versions + compare + rollback
  await page.getByRole("tab", { name: /Versions/ }).click();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.getByText("Restored v1")).toBeVisible();

  expect(errors).toEqual([]);
});
