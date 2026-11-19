// Run against the installed debug demo on a disposable emulator. CDP drives the
// normal WebView controls. Back always comes from Android (KEYCODE_BACK), not JS.
const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const pkg = "com.aurum.jewellery.preview",
  out = "test-results/phone";
const shell = (...args) =>
  execFileSync("adb", ["shell", ...args], { encoding: "utf8", timeout: 15000 });
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const key = () => shell("input", "keyevent", "4");
const focus = () =>
  shell("dumpsys", "window")
    .split("\n")
    .filter((s) => s.includes("mCurrentFocus"))
    .join(" ");
async function until(name, check, ms = 8000) {
  const deadline = Date.now() + ms;
  let last;
  do {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await pause(100);
  } while (Date.now() < deadline);
  throw Error(`Timed out: ${name}; last=${last}; focus=${focus()}`);
}
let ws,
  next = 0;
const pending = new Map();
function evaluate(expression) {
  return new Promise((ok, fail) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(Error("WebView did not answer"));
    }, 5000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error || msg.result?.exceptionDetails)
        fail(Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails)));
      else ok(msg.result.result?.value);
    });
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }),
    );
  });
}
async function attach() {
  const qemu =
    shell("getprop", "ro.boot.qemu").trim() === "1" ||
    shell("getprop", "ro.kernel.qemu").trim() === "1";
  assert.ok(qemu, "Disposable emulator required");
  fs.mkdirSync(out, { recursive: true });
  console.log(
    shell("am", "start", "-W", "-n", pkg + "/com.aurum.jewellery.MainActivity"),
  );
  const socket = await until(
    "debug WebView socket",
    () => {
      const pid = shell("pidof", pkg).trim().split(" ")[0];
      return shell("cat", "/proc/net/unix").match(
        new RegExp("@(webview_devtools_remote_" + pid + ")\\s*(?:\\n|$)"),
      )?.[1];
    },
    25000,
  );
  execFileSync("adb", ["forward", "tcp:9222", "localabstract:" + socket]);
  const target = await until(
    "app page in WebView",
    async () => {
      const targets = await (
        await fetch("http://127.0.0.1:9222/json/list")
      ).json();
      return targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    },
    10000,
  );
  // Always use our own loopback forward rather than an advertised Host header.
  const url = new URL(target.webSocketDebuggerUrl);
  url.host = "127.0.0.1:9222";
  ws = new WebSocket(url);
  await new Promise((ok, fail) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => fail(Error("WebView socket refused")), {
      once: true,
    });
  });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  console.log("WebView:", await evaluate("navigator.userAgent"));
  await until(
    "mounted Dashboard",
    () => evaluate('!!document.querySelector("[data-shop-home]")'),
    25000,
  );
}
before(attach);
after(() => {
  if (ws) ws.close();
});
afterEach(async (context) => {
  if (context.passed === false && ws) {
    try {
      console.log(
        "WebView after failure:",
        await evaluate("document.body.innerText.slice(-1400)"),
      );
    } catch {}
    if (focus().includes("printspooler")) {
      key();
      await pause(500);
    }
  }
});
const route = (path) =>
  until("in-app " + path, () =>
    evaluate(`(location.hash.slice(1)||'/')===${JSON.stringify(path)}`),
  );
const click = (selector) =>
  until("click " + selector, () =>
    evaluate(
      `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)return false;n.click();return true;})()`,
    ),
  );
const btn = (text, contains = false) =>
  until("button " + text, () =>
    evaluate(
      `(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.offsetWidth>0&&!n.disabled&&n.innerText.trim()${contains ? ".includes(" + JSON.stringify(text) + ")" : "===" + JSON.stringify(text)});if(!n)return false;n.click();return true;})()`,
    ),
  );
const present = (selector) =>
  until("visible " + selector, () =>
    evaluate(
      `!!document.querySelector(${JSON.stringify(selector)})?.offsetWidth`,
    ),
  );
const absent = (selector) =>
  until("closed " + selector, () =>
    evaluate(`!document.querySelector(${JSON.stringify(selector)})`),
  );
const has = (selector, text) =>
  until("read " + text, () =>
    evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.innerText.includes(${JSON.stringify(text)})`,
    ),
  );
async function select(label, value) {
  await until(`select ${label}=${value}`, () =>
    evaluate(
      `(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)}),s=l?.querySelector('select');if(!s)return false;s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));return s.value===${JSON.stringify(value)};})()`,
    ),
  );
}
const detail = '[role="dialog"][data-state="open"]';
const foreground = () =>
  until("shop in foreground", () => focus().includes(pkg));
async function go(path) {
  await click(`.sidebar a[href="#${path}"]`);
  await route(path);
}
async function home() {
  await click(".sidebar .brand-link");
  await present("[data-shop-home]");
}
for (const [name, path, prior] of [
  ["Billing", "/billing", "/"],
  ["Inventory", "/inventory", "/billing"],
  ["Settings", "/settings", "/inventory"],
  ["Reports", "/reports", "/settings"],
])
  test(name + " returns to actual previous page", async () => {
    await home();
    if (prior !== "/") await go(prior);
    await go(path);
    key();
    await route(prior);
    await foreground();
  });
for (const [path, title] of [
  ["/inventory", "Product details"],
  ["/customers", "Customer profile"],
])
  test(title + " returns to list", async () => {
    await go(path);
    await click("tbody tr");
    await has(detail, title);
    key();
    await absent(detail);
    await route(path);
    await foreground();
  });
test("Topmost modal before drawer, drawer before route", async () => {
  await home();
  await click('[aria-label="Open navigation"]');
  await click(".shop-switch");
  await present(detail);
  key();
  await absent(detail);
  await present(".drawer-backdrop");
  key();
  await absent(".drawer-backdrop");
  await route("/");
  await foreground();
});
async function newSale() {
  await go("/billing");
  await click('.page-head a[href="#/billing/new"]');
  await btn("Add product to bill");
  await btn("Heritage gold bangle", true);
  await has(".bill-line", "Heritage gold bangle");
}
test("Dirty bill needs explicit discard; Continue Editing preserves line", async () => {
  await newSale();
  key();
  await btn("Continue Editing");
  await has(".bill-line", "Heritage gold bangle");
  key();
  await btn("Discard Changes");
  await route("/billing");
  await foreground();
});
test("First Dashboard Back shows the nonblocking hint", async () => {
  await home();
  key();
  await has(".toast", "Press back again to exit");
  await route("/");
  await foreground();
});
test("Dashboard timeout resets the exit window", async () => {
  await go("/rates");
  await home();
  key();
  await has(".toast", "Press back");
  await absent(".toast");
  key();
  await has(".toast", "Press back");
  await foreground();
});
test("No minimize on receipt → billing → inventory", async () => {
  await go("/inventory");
  await go("/billing");
  await click("tbody tr");
  await present(".receipt");
  key();
  await route("/billing");
  key();
  await route("/inventory");
  await foreground();
});
function dump() {
  shell("uiautomator", "dump", "/sdcard/print-window.xml");
  return shell("cat", "/sdcard/print-window.xml");
}
for (const format of ["A4", "A5", "80mm", "58mm"])
  test(`${format}: open Android PrintManager and Back to receipt`, async () => {
    await go("/settings");
    await btn("Billing & print");
    await select("Paper format", format);
    await btn("Save settings");
    await has(".toast", "saved");
    await newSale();
    await select("Payment", "full");
    await btn("Finalize invoice");
    await btn("Confirm & save");
    await present(`.receipt[data-format="${format}"]`);
    await btn("Print / PDF");
    await until(
      "Android print spooler",
      () => focus().includes("printspooler"),
      18000,
    );
    let xml = dump();
    const handle = (xml.match(/<node\b[^>]*>/g) || []).find((n) =>
      /(?:expand_collapse_handle|content-desc="Expand)/i.test(n),
    );
    const box = handle?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (box) {
      shell(
        "input",
        "tap",
        String((+box[1] + +box[3]) >> 1),
        String((+box[2] + +box[4]) >> 1),
      );
      await pause(500);
      xml = dump();
    }
    fs.writeFileSync(`${out}/print-${format}.xml`, xml);
    fs.writeFileSync(
      `${out}/print-${format}.png`,
      execFileSync("adb", ["exec-out", "screencap", "-p"]),
    );
    console.log(
      "SPOOLER",
      format,
      [...xml.matchAll(/text="([^"<>]+)"/g)].map((m) => m[1]).join(" | "),
    );
    assert.match(xml, /Save as PDF/i);
    if (format === "A4" || format === "A5")
      assert.match(
        xml,
        new RegExp(`\\b${format}\\b`, "i"),
        "Requested ISO size should be selected, not Letter",
      );
    for (let i = 0; i < 3 && focus().includes("printspooler"); i++) {
      key();
      await pause(450);
    }
    await foreground();
    await present(`.receipt[data-format="${format}"]`);
  });
test("Second Back within two seconds finishes, not minimizes, the Dashboard", async () => {
  await home();
  key();
  await has(".toast", "Press back");
  key();
  await until("Activity leaves foreground", () => !focus().includes(pkg));
  await until(
    "Activity is finished",
    () =>
      !new RegExp("Hist #[^\\n]*" + pkg.replaceAll(".", "\\.")).test(
        shell("dumpsys", "activity", "activities"),
      ),
  );
});
