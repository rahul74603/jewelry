// Used only by the emulator suite. Run the live UI with the SDK's official
// emulator connections; the app sources and shipped build contain no test switch.
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

module.exports = async function checkLiveDraft({ email, password }, code) {
  const { build, preview } = await import("vite");
  const root = path.resolve(__dirname, "../.."),
    outDir = await mkdtemp(path.join(tmpdir(), "aurum-live-draft-"));
  const env = {
    VITE_APP_MODE: "live",
    VITE_FIREBASE_PROJECT_ID: "demo-aurum",
    VITE_FIREBASE_API_KEY: "demo-only",
    VITE_FIREBASE_AUTH_DOMAIN: "127.0.0.1",
    VITE_FIREBASE_APP_ID: "1:123:web:abc",
    VITE_APP_CHECK_SITE_KEY: "demo-only",
  };
  let server, browser;
  try {
    await build({
      root,
      logLevel: "error",
      build: { outDir },
      define: Object.fromEntries(
        Object.entries(env).map(([k, v]) => [
          "import.meta.env." + k,
          JSON.stringify(v),
        ]),
      ),
      plugins: [
        {
          name: "local-emulator-connections",
          transformIndexHtml: {
            order: "pre",
            handler: () => [
              {
                tag: "script",
                attrs: { type: "module" },
                injectTo: "head-prepend",
                children: `
        import {auth} from '/src/lib/cloud.ts';
        import {connectAuthEmulator} from 'firebase/auth';
        import {connectFunctionsEmulator,getFunctions} from 'firebase/functions';
        connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
        connectFunctionsEmulator(getFunctions(auth.app,'asia-south1'),'127.0.0.1',5001);
      `,
              },
            ],
          },
        },
      ],
    });
    server = await preview({
      root,
      logLevel: "error",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
    });
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      channel:
        !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE &&
        process.env.GITHUB_ACTIONS
          ? "chrome"
          : undefined,
    });
    const page = await browser.newPage({ serviceWorkers: "block" });
    // App Check is not enforced by the Functions emulator; never exchange a
    // debug token with a real project or send any test traffic outside loopback.
    await page.addInitScript(() => {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    });
    await page.route("**/*", (r) =>
      new URL(r.request().url()).hostname === "127.0.0.1"
        ? r.continue()
        : r.abort(),
    );
    page.setDefaultTimeout(15000);
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/#/billing`,
    );
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page.getByLabel("One-time activation code").fill(code);
    await page.getByRole("button", { name: "Activate device" }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: /Drafts/ }).click();
      await page.getByRole("row").filter({ hasText: "Non-GST bill" }).click();
      await expect(
        page.getByRole("combobox", { name: "Payment", exact: true }),
      ).toHaveValue("part");
      await expect(page.getByLabel("Amount received (₹)")).toHaveValue("0");
      await expect(
        page.getByRole("combobox", { name: "Payment mode" }),
      ).toHaveValue("Bank");
      if (i === 0)
        await page.getByRole("button", { name: "Save draft" }).click();
    }
    await page.getByRole("button", { name: "Finalize invoice" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Received · Bank: ₹0.00. Outstanding: ₹5,000.00",
    );
    await page.getByRole("button", { name: "Confirm & save" }).click();
    await expect(
      page
        .locator(".receipt-totals")
        .getByText("Balance", { exact: true })
        .locator("..")
        .locator("dd"),
    ).toHaveText("₹5,000.00");
    await expect(page.locator(".receipt")).not.toContainText("SAMPLE");
  } finally {
    await browser?.close();
    await server?.close();
    await rm(outDir, { recursive: true, force: true });
  }
};
