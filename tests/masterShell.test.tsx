import { describe, it, expect, vi, afterEach } from "vitest";
import { Suspense, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

/**
 * Smoke test: the Master build mounts the full shop shell AND the
 * master sidebar entries, and the Customer (Demo) build mounts the
 * shop shell with NO master entries.
 *
 * renderToString runs in plain node (no jsdom installed): effects
 * never run during SSR, so no network, no heartbeat, no update
 * check and no localStorage are touched — only the render path is
 * exercised, which is exactly what "mounts without crashing" means
 * here. The Master APK itself is NOT emulator-tested in CI.
 */

async function renderEntry(mode: string, entry: "Master" | "Demo") {
  vi.stubEnv("VITE_APP_MODE", mode);
  vi.resetModules();
  const mod = await import(`../src/${entry}`);
  const Root = mod.default as ComponentType;
  return renderToString(
    <MemoryRouter initialEntries={["/"]}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </MemoryRouter>,
  );
}

describe("Master build mounts shop shell + master sidebar", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("Master shows the shop screens and the three master entries", async () => {
    const html = await renderEntry("master", "Master");
    // Shop shell: dashboard + billing + stock + customers + loans.
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/inventory"');
    expect(html).toContain('href="/customers"');
    expect(html).toContain('href="/loans"');
    expect(html).toContain("Dashboard");
    // Master-only sidebar entries (plain Hindi labels).
    expect(html).toContain('href="/master/code"');
    expect(html).toContain("Code banao");
    expect(html).toContain('href="/master/licenses"');
    expect(html).toContain("Licenses");
    expect(html).toContain('href="/master/updates"');
    expect(html).toContain("Updates");
  });

  it("Customer (Demo) build shows the shop shell and NO master entries", async () => {
    const html = await renderEntry("demo", "Demo");
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/inventory"');
    expect(html).toContain("Dashboard");
    expect(html).not.toContain('href="/master/code"');
    expect(html).not.toContain('href="/master/licenses"');
    expect(html).not.toContain('href="/master/updates"');
    expect(html).not.toContain("Code banao");
    expect(html).not.toContain("Sabko update bhejo");
  });
});
