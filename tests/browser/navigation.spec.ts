import { test, expect, type Page } from "@playwright/test";
// Desktop Chromium tests the React Router/overlay/dirty arbitration, NOT the
// Android system callback. The APK suite sends real KEYCODE_BACK via adb.
const link = (p: Page, path: string) =>
  p.locator(`.sidebar a[href="#${path}"]`).first().click();
test("Browser Back/Forward preserve nested in-app history, not a dashboard redirect", async ({
  page,
}) => {
  await page.goto("/");
  await link(page, "/reports");
  await link(page, "/inventory");
  await page.locator("tbody tr").first().click();
  await expect(page.getByRole("dialog")).toContainText("Product details");
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/inventory$/);
});
test("Browser Back dismisses a transient overlay without consuming the previous page", async ({
  page,
}) => {
  await page.goto("/");
  await link(page, "/reports");
  await page.getByRole("button", { name: "View notifications" }).click();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(/reports$/);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
});
for (const [path, button, field] of [
  ["inventory", "Add product", "Product name"],
  ["customers", "Add customer", "Customer name"],
] as const)
  test(`Dirty ${path}: Back keeps values until explicitly discarded`, async ({
    page,
  }) => {
    await page.goto("/");
    await link(page, "/" + path);
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByLabel(field, { exact: true }).fill("Unsaved value");
    await page.goBack();
    const dialog = page.getByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue Editing" }).click();
    await expect(page.getByLabel(field, { exact: true })).toHaveValue(
      "Unsaved value",
    );
    await page.getByRole("button", { name: "Close dialog" }).click();
    await dialog.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).toHaveURL(new RegExp(path + "$"));
  });
test("Bill keeps selected lines beneath the item picker and discard confirmation", async ({
  page,
}) => {
  await page.goto("/#/billing");
  await page.getByRole("link", { name: "New invoice", exact: true }).click();
  await page.getByRole("button", { name: "Add product to bill" }).click();
  await page.getByRole("button", { name: /Heritage gold bangle/ }).click();
  await page.getByRole("button", { name: "Add product to bill" }).click();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".bill-line")).toContainText(
    "Heritage gold bangle",
  );
  await page.goBack();
  await page.getByRole("button", { name: "Continue Editing" }).click();
  await expect(page.locator(".bill-line")).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Discard Changes" }).click();
  await expect(page).toHaveURL(/billing$/);
});
test("Unsaved settings survive attempted navigation; successful save clears the guard", async ({
  page,
}) => {
  await page.goto("/");
  await link(page, "/settings");
  await page.getByLabel("Shop name", { exact: true }).fill("Draft identity");
  await link(page, "/reports");
  await page.getByRole("button", { name: "Continue Editing" }).click();
  await expect(page.getByLabel("Shop name", { exact: true })).toHaveValue(
    "Draft identity",
  );
  await page.getByRole("button", { name: "Save settings" }).click();
  await link(page, "/reports");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/reports$/);
});
