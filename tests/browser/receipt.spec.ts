import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
const open = async (p: Page, path: string) =>
  p
    .locator(`a[href="#${path}"]`)
    .first()
    .evaluate((a: HTMLAnchorElement) => a.click());
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
test.use({ actionTimeout: 6500 });
const combo = (p: Page, name: string) =>
  p.getByRole("combobox", { name, exact: true });
const byLabel = (p: Page, name: string) => p.getByLabel(name, { exact: true });
async function add(p: Page, name: string) {
  await button(p, "Add product to bill").click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}
async function save(p: Page) {
  await button(p, "Finalize invoice").click();
  await button(p, "Confirm & save").click();
  await expect(p.locator(".receipt")).toBeVisible();
}
async function branding(p: Page, format: string) {
  await p.goto("/#/settings");
  await byLabel(p, "Shop name").fill("तारा Atelier");
  await byLabel(p, "Owner name").fill("Owner Two");
  // A real, differently proportioned logo processed through Settings' upload path.
  const png = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 100;
    c.height = 40;
    const x = c.getContext("2d")!;
    x.fillStyle = "#603718";
    x.fillRect(0, 0, 100, 40);
    x.fillStyle = "white";
    x.font = "28px serif";
    x.fillText("TA", 28, 30);
    return c.toDataURL().split(",")[1];
  });
  await p.locator("input[type=file]").setInputFiles({
    name: "shop.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(p.locator(".logo-preview img")).toBeVisible();
  await button(p, "Billing & print").click();
  await combo(p, "Paper format").selectOption(format);
  await p.getByLabel(/Invoice prefix/).fill("TA");
  await byLabel(p, "Print owner name").check();
  await p
    .getByRole("textbox", { name: "Thank-you message", exact: true })
    .fill("धन्यवाद · Welcome again");
  await byLabel(p, "Return / exchange policy").fill(
    "Keep your original receipt.",
  );
  await byLabel(p, "Invoice terms").fill("Inspect the item at collection.");
  await button(p, "Save settings").click();
  await expect(p.getByRole("status")).toContainText("saved");
}
const names = [
  "Heritage gold bangle",
  "Lotus drop earrings",
  "Classic gold band",
  "Silver anklet pair",
  "Lakshmi gold coin",
  "Petite diamond pendant",
  "Temple gold necklace",
  "Silver filigree ring",
  "Everyday hoop earrings",
  "Antique gold chain",
];
for (const [format, w, h] of [
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["80mm", 80, 200],
  ["58mm", 58, 200],
] as const)
  test(`Issued ${format} PDF: actual MediaBoxes, glyphs, branding, pagination, end matter`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await branding(page, format);
    await open(page, "/billing");
    await open(page, "/billing/new");
    await combo(page, "Customer").selectOption({ label: "Priya Patel" });
    for (const name of names) {
      await add(page, name);
      const row = page.locator(".bill-line").filter({ hasText: name });
      await row.getByRole("button", { name: /Adjust making/ }).click();
      await row.getByLabel("Wastage %").fill("1");
      await row.getByLabel("Stone value / piece (₹)").fill("20");
      await row.getByLabel("Other charges / piece (₹)").fill("15");
      await row.getByLabel("Line discount (₹)").fill("5");
    }
    await byLabel(page, "Amount received (₹)").fill("30000");
    await combo(page, "Payment mode").selectOption("UPI");
    await save(page);
    const receipt = page.locator(".receipt");
    await expect(receipt.locator(".receipt-brand img")).toHaveCount(1);
    await expect(receipt).toContainText("TA-");
    await expect(receipt).not.toContainText("GSTIN");
    await expect(receipt).not.toContainText("CGST");
    await expect(receipt.locator(".approved-mark")).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(360);
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
    });
    await writeFile(info.outputPath(format + ".pdf"), pdf);
    await info.attach(format + ".pdf", {
      body: pdf,
      contentType: "application/pdf",
    });
    const doc = await getDocument({
      data: new Uint8Array(pdf),
      useSystemFonts: false,
    }).promise;
    const text: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const sheet = await doc.getPage(i),
        [, , x, y] = sheet.view;
      expect(Math.abs(x - (w * 72) / 25.4)).toBeLessThan(1.1);
      expect(Math.abs(y - (h * 72) / 25.4)).toBeLessThan(1.1);
      const { items } = await sheet.getTextContent();
      const pageText = items
        .filter((t) => "str" in t)
        .map((t) => t.str)
        .join(" ");
      expect(pageText.trim().length, `page ${i} blank?`).toBeGreaterThan(8);
      text.push(pageText);
      for (const item of items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [left, base] = item.transform.slice(-2);
        const margin =
          ({ A4: 9, A5: 6, "80mm": 3, "58mm": 2 }[format] * 72) / 25.4;
        expect(left, item.str).toBeGreaterThanOrEqual(margin - 1);
        expect(left + item.width, item.str).toBeLessThanOrEqual(
          x - margin + 0.5,
        );
        expect(base, item.str).toBeGreaterThan(0);
        expect(base, item.str).toBeLessThan(y);
      }
      if (i === 1)
        expect((await sheet.getOperatorList()).fnArray).toContain(
          OPS.paintImageXObject,
        );
      if (i === 1)
        console.log(
          `${format}: ${doc.numPages} pages; MediaBox ${sheet.view.join(" ")} pt`,
        );
    }
    expect(doc.numPages).toBeGreaterThan(1);
    const content = text.join(" ").replace(/\s+/g, " ");
    for (const t of [
      "तारा",
      "धन्यवाद",
      "Atelier",
      "Owner Two",
      "NON-GST BILL",
      "Priya Patel",
      "Amount summary",
      "Payment summary",
      "Received · UPI",
      "₹30,000.00",
      "Total received",
      "Balance",
      "Amount in words",
      "Authorised signature",
      "Inspect the item",
      "Welcome again",
      ...names,
    ])
      expect(content.toLowerCase().replace(/\s/g, "")).toContain(
        t.toLowerCase().replace(/\s/g, ""),
      );
    expect(content).not.toContain("\uFFFD");
    await doc.destroy();
  });
test("Two-mode ₹1,06,023.90 receipt; historical brand and tenders survive settings and credit note", async ({
  page,
}) => {
  await branding(page, "A4");
  await open(page, "/billing");
  await open(page, "/billing/new");
  await combo(page, "Customer").selectOption({ label: "Priya Patel" });
  await add(page, names[0]);
  await add(page, names[3]);
  await combo(page, "Payment mode").selectOption("Split");
  await byLabel(page, "Cash received (₹)").fill("10000");
  await byLabel(page, "UPI received (₹)").fill("20000");
  await button(page, "Save draft").click();
  await page.getByRole("button", { name: /Drafts/ }).click();
  await page.locator("tbody tr").first().click();
  await expect(byLabel(page, "Amount received (₹)")).toHaveValue("30000");
  await save(page);
  const receipt = page.locator(".receipt");
  for (const [t, value] of [
    ["Grand total", "₹1,06,023.90"],
    ["Received · Cash", "₹10,000.00"],
    ["Received · UPI", "₹20,000.00"],
    ["Total received", "₹30,000.00"],
    ["Balance", "₹76,023.90"],
  ])
    await expect(
      receipt.getByText(t, { exact: true }).locator("..").locator("dd"),
    ).toHaveText(value);
  await expect(receipt).toContainText(
    "Rupees One Lakh Six Thousand Twenty Three and Ninety Paise Only",
  );
  await open(page, "/settings");
  await byLabel(page, "Shop name").fill("Different identity");
  await button(page, "Save settings").click();
  await page.goBack();
  await expect(receipt).toContainText("तारा Atelier");
  await expect(receipt).not.toContainText("Different identity");
  await button(page, "Void document").click();
  await byLabel(page, "Reason for reversal").fill("Full return");
  await button(page, "Confirm reversal").click();
  await page.getByRole("link", { name: "View credit note" }).click();
  await expect(receipt.locator(".paper-title h3")).toHaveText("CREDIT NOTE");
  await expect(receipt).toContainText("Against TA-");
  await expect(receipt).toContainText("Different identity");
  await expect(receipt).toContainText("Dues reversed");
  await expect(receipt).not.toContainText("NON-GST BILL");
});
test("Estimate is a quote, not a bill or a payment; conversion issues a separate final document", async ({
  page,
}) => {
  await page.goto("/#/billing/new?estimate=1");
  await add(page, names[0]);
  await button(page, "Save estimate").click();
  await button(page, "Confirm & save").click();
  const receipt = page.locator(".receipt");
  await expect(receipt.locator(".paper-title h3")).toHaveText("ESTIMATE");
  await expect(receipt).toContainText("Not a tax invoice");
  await expect(receipt).not.toContainText("Payment summary");
  await page.getByRole("link", { name: "Convert to invoice" }).click();
  await page
    .getByRole("combobox", { name: "Payment", exact: true })
    .selectOption("full");
  await save(page);
  await expect(receipt.locator(".paper-title h3")).toHaveText("NON-GST BILL");
  await expect(receipt).not.toContainText("ESTIMATE");
});
test("Advance records a customer deposit with purpose, not a taxable item sale", async ({
  page,
}) => {
  await page.goto("/#/billing/new");
  await combo(page, "Document type").selectOption("Advance receipt");
  await combo(page, "Customer").selectOption({ label: "Priya Patel" });
  await page.getByLabel(/Advance for/).fill("Bangle order");
  await byLabel(page, "Amount received (₹)").fill("1000");
  await button(page, "Record advance").click();
  await button(page, "Confirm & save").click();
  const r = page.locator(".receipt");
  await expect(r.locator(".paper-title h3")).toHaveText("ADVANCE RECEIPT");
  await expect(r).toContainText("Bangle order");
  await expect(r).not.toContainText("Jewellery items");
  await expect(r).not.toContainText("Taxable value");
});

test("Silver Payal is one uncluttered A4 page: actual ₹2,100, no tax/empty contacts", async ({
  page,
}, info) => {
  await branding(page, "A4");
  await open(page, "/inventory");
  await button(page, "Add product").click();
  const dialog = page.getByRole("dialog");
  for (const [name, value] of [
    ["Product name", "चाँदी पायल / Silver Payal"],
    ["SKU / barcode", "PAYAL-1"],
    ["Category", "Payal"],
    ["Metal", "Silver"],
    ["Purity", "Fine"],
    ["Gross weight / piece (g)", "10"],
    ["Default making amount / rate", "200"],
  ])
    await dialog.getByLabel(name, { exact: true }).fill(value);
  await dialog
    .getByRole("button", { name: "Add product", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await open(page, "/rates");
  await page
    .getByRole("button", { name: /Update rate/ })
    .first()
    .click();
  await dialog.locator("input[name=metal]").fill("Silver");
  await dialog.getByLabel("Purity", { exact: true }).fill("Fine");
  await dialog.getByLabel(/per gram/).fill("200");
  await dialog.getByRole("button", { name: /Record rate/ }).click();
  await expect(dialog).toBeHidden();
  await open(page, "/billing/new");
  await add(page, "Silver Payal");
  await page.getByRole("button", { name: /Adjust making/ }).click();
  await page.getByLabel("Line discount (₹)").fill("100");
  await page
    .getByRole("combobox", { name: "Payment", exact: true })
    .selectOption("full");
  await save(page);
  const r = page.locator(".receipt");
  await expect(r).toContainText("₹2,100.00");
  await expect(r.locator(".paper-title h3")).toHaveText("NON-GST BILL");
  await expect(r).not.toContainText(/GSTIN|HSN|SGST|IGST|CGST|undefined|null/);
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
  expect(doc.numPages).toBe(1);
  await writeFile(info.outputPath("Payal-A4.pdf"), pdf);
  await doc.destroy();
});
