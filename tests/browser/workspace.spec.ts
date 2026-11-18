import { test, expect } from "@playwright/test";
test("Phone navigation, business profile and session-only fixtures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Shop settings", exact: true }).click();
  await page.getByLabel("Shop name", { exact: true }).fill("Test Atelier");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(page.locator(".hero p")).toContainText("Test Atelier");
  await page.reload();
  await expect(page.locator(".hero p")).not.toContainText("Test Atelier");
});
test("A draft does not move stock; finalize, shareable document and reversal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "New invoice", exact: true }).click();
  await page.getByRole("button", { name: "Add product to bill" }).click();
  await page.getByRole("button", { name: /Heritage gold bangle/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: /Drafts/ }).click();
  await page.getByRole("row").filter({ hasText: "Non-GST bill" }).click();
  await page.getByRole("button", { name: "Finalize invoice" }).click();
  await page.getByRole("button", { name: "Confirm & save" }).click();
  await expect(page.locator(".receipt")).toContainText("Heritage gold bangle");
  await expect(page.locator(".receipt")).toContainText("SAMPLE");
  await page.getByRole("button", { name: "Void document" }).click();
  await page.getByLabel("Reason for reversal").fill("Acceptance test");
  await page.getByRole("button", { name: "Confirm reversal" }).click();
  await expect(page.locator(".receipt")).toContainText("VOIDED");
});
test("Search a product, adjust stock and add a customer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search anything/ }).click();
  await page
    .getByPlaceholder("Search pages, products, customers, invoices…")
    .fill("Heritage");
  await page.getByRole("button", { name: /Heritage gold bangle/ }).click();
  await page.getByRole("button", { name: "Adjust stock" }).click();
  await page.getByLabel("Quantity change").fill("2");
  await page.getByLabel("Reason", { exact: true }).fill("Opening recount");
  await page.getByRole("button", { name: "Record adjustment" }).click();
  await expect(page.getByRole("dialog")).toContainText("20 pieces");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Customers", exact: true })
    .click();
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await page.getByLabel("Customer name").fill("New Buyer");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add customer", exact: true })
    .click();
  await page
    .getByPlaceholder("Find a customer by name or phone…")
    .fill("New Buyer");
  await expect(
    page.getByRole("row").filter({ hasText: "New Buyer" }),
  ).toBeVisible();
});
