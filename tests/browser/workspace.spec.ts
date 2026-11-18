import { test, expect, type Page } from "@playwright/test";
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
  await page
    .getByRole("combobox", { name: "Payment", exact: true })
    .selectOption("full");
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
  // Navigation closes the asynchronous form. Do not type into the background
  // search box while the accessible dialog still owns keyboard focus.
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Customer added.");
  const search = page.getByRole("searchbox", {
    name: "Find a customer by name or phone…",
  });
  await search.fill("New Buyer");
  await expect(search).toHaveValue("New Buyer");
  await expect(
    page.getByRole("row").filter({ hasText: "New Buyer" }),
  ).toBeVisible();
});
test("A finalized bill produces a printable PDF from its snapshot", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".invoices-table tbody tr").first().click();
  await expect(page.locator(".receipt-brand h2")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".receipt")).toBeVisible();
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(5000);
});

async function openPaymentBill(page: Page, fiveThousand = true) {
  await page.goto("/#/billing/new");
  await page
    .getByRole("combobox", { name: "Customer", exact: true })
    .selectOption({ label: "Meera Sharma" });
  await page.getByRole("button", { name: "Add product to bill" }).click();
  await page.getByRole("button", { name: /Heritage gold bangle/ }).click();
  await expect(page.locator(".grand-total strong")).toHaveText("₹99,742.50");
  if (fiveThousand) {
    await page.getByRole("button", { name: /Adjust making/ }).click();
    await page.getByLabel("Line discount (₹)").fill("94742.50");
    await expect(page.locator(".grand-total strong")).toHaveText("₹5,000.00");
  }
  await page
    .getByRole("combobox", { name: "Payment mode", exact: true })
    .selectOption("UPI");
}
async function reopen(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: /Drafts/ }).click();
  await page.getByRole("row").filter({ hasText: "Non-GST bill" }).click();
  await expect(page.getByRole("heading", { name: "Edit draft" })).toBeVisible();
}
test("₹99,742.50: reopening a zero-received credit draft repeatedly never collects cash", async ({
  page,
}) => {
  await openPaymentBill(page, false);
  for (let i = 0; i < 3; i++) {
    await reopen(page);
    await expect(
      page.getByRole("combobox", { name: "Payment", exact: true }),
    ).toHaveValue("part");
    await expect(page.getByLabel("Amount received (₹)")).toHaveValue("0");
    await expect(
      page.getByRole("combobox", { name: "Payment mode", exact: true }),
    ).toHaveValue("UPI");
    await expect(
      page.getByText("Balance due", { exact: true }).locator(".."),
    ).toContainText("₹99,742.50");
  }
});
for (const c of [
  {
    name: "zero credit",
    paid: 0,
    choice: "part",
    received: "₹0.00",
    due: "₹5,000.00",
  },
  {
    name: "partial",
    paid: 2000,
    choice: "part",
    received: "₹2,000.00",
    due: "₹3,000.00",
  },
  {
    name: "explicit full selection",
    paid: 5000,
    choice: "full",
    received: "₹5,000.00",
    due: "₹0.00",
  },
  {
    name: "entered full amount",
    paid: 5000,
    choice: "full",
    received: "₹5,000.00",
    due: "₹0.00",
  },
]) {
  test(`₹5,000 ${c.name}: draft, reopen, confirmation and posted receipt agree`, async ({
    page,
  }) => {
    await openPaymentBill(page);
    const payment = page.getByRole("combobox", {
      name: "Payment",
      exact: true,
    });
    await expect(payment).toHaveValue("part");
    if (c.name === "explicit full selection")
      await payment.selectOption("full");
    else await page.getByLabel("Amount received (₹)").fill(String(c.paid));
    await reopen(page);
    await expect(payment).toHaveValue(c.choice);
    await expect(page.getByLabel("Amount received (₹)")).toHaveValue(
      String(c.paid),
    );
    await expect(
      page.getByRole("combobox", { name: "Payment mode", exact: true }),
    ).toHaveValue("UPI");
    await page.getByRole("button", { name: "Finalize invoice" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.locator(".confirm-total")).toHaveText("₹5,000.00");
    await expect(confirm).toContainText(
      `Received · UPI: ${c.received}. Outstanding: ${c.due}`,
    );
    await confirm.getByRole("button", { name: "Confirm & save" }).click();
    const totals = page.locator(".receipt-totals");
    for (const [label, amount] of [
      ["Grand total", "₹5,000.00"],
      ["Received · UPI", c.received],
      ["Balance", c.due],
    ]) {
      await expect(
        totals.getByText(label, { exact: true }).locator("..").locator("dd"),
      ).toHaveText(amount);
    }
  });
}
test("a deliberate change to a saved payment can be re-saved and finalized", async ({
  page,
}) => {
  await openPaymentBill(page);
  await reopen(page);
  await page.getByLabel("Amount received (₹)").fill("2000");
  await page.getByRole("button", { name: "Finalize invoice" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Payment differs from the saved draft",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await reopen(page);
  await page.getByRole("button", { name: "Finalize invoice" }).click();
  await page.getByRole("button", { name: "Confirm & save" }).click();
  await expect(
    page
      .locator(".receipt-totals")
      .getByText("Balance", { exact: true })
      .locator(".."),
  ).toContainText("₹3,000.00");
});
