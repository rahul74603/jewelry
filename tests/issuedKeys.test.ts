import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadIssuedKeys,
  saveIssuedKeys,
  addRow,
  searchRows,
  flagRows,
  toCSV,
  toText,
  ISSUED_KEYS_STORAGE_KEY,
  type IssuedKeyRow,
} from "../src/lib/issuedKeys";
import { developerWhatsAppLink } from "../src/lib/offlineActivation";
import {
  getDeviceModel,
  parseDeviceModelFromUserAgent,
} from "../src/lib/device";

/** Minimal in-memory stand-in for localStorage (vitest runs in node). */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

function row(over: Partial<IssuedKeyRow> = {}): IssuedKeyRow {
  return {
    id: "row-1",
    date: "2026-11-24T10:00:00.000Z",
    buyerName: "Ramesh Jewellers",
    buyerNumber: "9876543210",
    deviceCode: "A1B2C3D4",
    deviceId: "ABCD-1234-EF01",
    model: "Infinix ZERO 5G 2023",
    imei: "860123045678901",
    unlockKey: "KEY12345",
    note: "",
    ...over,
  };
}

describe("issued-keys register: load / save", () => {
  it("round-trips rows through storage", () => {
    const storage = fakeStorage();
    expect(loadIssuedKeys(storage)).toEqual([]);
    saveIssuedKeys([row()], storage);
    expect(loadIssuedKeys(storage)).toEqual([row()]);
  });

  it("returns an empty list for corrupt, non-array, or malformed data — never crashes", () => {
    const storage = fakeStorage();
    storage.setItem(ISSUED_KEYS_STORAGE_KEY, "{not json");
    expect(loadIssuedKeys(storage)).toEqual([]);
    storage.setItem(ISSUED_KEYS_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadIssuedKeys(storage)).toEqual([]);
    storage.setItem(
      ISSUED_KEYS_STORAGE_KEY,
      JSON.stringify([row(), { id: "", date: "" }, "junk", null]),
    );
    expect(loadIssuedKeys(storage)).toEqual([row()]);
  });

  it("load/save are safe with no storage at all", () => {
    expect(loadIssuedKeys(null)).toEqual([]);
    expect(() => saveIssuedKeys([row()], null)).not.toThrow();
  });
});

describe("issued-keys register: addRow", () => {
  it("prepends the new row (newest first) and normalises code / Device ID / key", () => {
    const next = addRow([row()], {
      buyerName: "  Meera  ",
      buyerNumber: " 9123456780 ",
      deviceCode: "a1b2c3d4",
      deviceId: "ffff-0000-1111",
      model: "Pixel 8",
      imei: "",
      unlockKey: "key99999",
      note: "Paid",
    });
    expect(next).toHaveLength(2);
    expect(next[0].buyerName).toBe("Meera");
    expect(next[0].deviceCode).toBe("A1B2C3D4");
    expect(next[0].deviceId).toBe("FFFF-0000-1111");
    expect(next[0].unlockKey).toBe("KEY99999");
    expect(next[0].id).toBeTruthy();
    expect(next[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(next[1].id).toBe("row-1");
  });
});

describe("issued-keys register: searchRows", () => {
  const rows = [
    row(),
    row({
      id: "row-2",
      buyerName: "Meera Sharma",
      buyerNumber: "+91 91234 56780",
      deviceCode: "B2C3D4E5",
      deviceId: "FFFF-0000-1111",
      model: "Pixel 8",
      imei: "358099112233445",
      unlockKey: "KEY99999",
    }),
  ];

  it("returns everything for an empty query", () => {
    expect(searchRows(rows, "")).toEqual(rows);
    expect(searchRows(rows, "   ")).toEqual(rows);
  });

  it("finds by buyer number ignoring spaces, +91 and dashes", () => {
    expect(searchRows(rows, "9876543210")).toHaveLength(1);
    expect(searchRows(rows, "+91 98765 43210").map((r) => r.id)).toEqual([
      "row-1",
    ]);
    expect(searchRows(rows, "9123456780").map((r) => r.id)).toEqual(["row-2"]);
  });

  it("finds by Device ID, case-insensitive with dashes ignored", () => {
    expect(searchRows(rows, "abcd1234ef01").map((r) => r.id)).toEqual([
      "row-1",
    ]);
    expect(searchRows(rows, "ffff-0000-1111").map((r) => r.id)).toEqual([
      "row-2",
    ]);
  });

  it("finds by IMEI and by buyer name", () => {
    expect(searchRows(rows, "860123045678901").map((r) => r.id)).toEqual([
      "row-1",
    ]);
    expect(searchRows(rows, "meera").map((r) => r.id)).toEqual(["row-2"]);
  });

  it("finds nothing for an unknown query", () => {
    expect(searchRows(rows, "0000000000")).toEqual([]);
  });
});

describe("issued-keys register: flagRows", () => {
  it("flags rows sharing a buyer number but a different Device ID", () => {
    const rows = [
      row(),
      row({ id: "row-2", deviceId: "FFFF-0000-1111", unlockKey: "KEY99999" }),
      row({
        id: "row-3",
        buyerName: "Other Buyer",
        buyerNumber: "9999999999",
        deviceId: "1111-2222-3333",
        unlockKey: "KEY00000",
      }),
    ];
    const flagged = flagRows(rows);
    expect([...flagged].sort()).toEqual(["row-1", "row-2"]);
  });

  it("does not flag a repeat key for the SAME Device ID (genuine re-issue)", () => {
    const rows = [
      row(),
      row({ id: "row-2", unlockKey: "KEY99999" }),
    ];
    expect(flagRows(rows).size).toBe(0);
  });

  it("does not flag rows with no buyer number", () => {
    const rows = [
      row({ buyerNumber: "" }),
      row({ id: "row-2", buyerNumber: "", deviceId: "FFFF-0000-1111" }),
    ];
    expect(flagRows(rows).size).toBe(0);
  });
});

describe("issued-keys register: export formatting", () => {
  it("toCSV has a header and one quoted row per key", () => {
    const csv = toCSV([row()]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      '"Date","Buyer name","Buyer number","Device code","Device ID","Phone model","IMEI","Unlock key","Note"',
    );
    expect(lines[1]).toContain('"Ramesh Jewellers"');
    expect(lines[1]).toContain('"ABCD-1234-EF01"');
    expect(lines[1]).toContain('"Infinix ZERO 5G 2023"');
    expect(lines).toHaveLength(2);
  });

  it("toCSV escapes quotes inside a field", () => {
    expect(toCSV([row({ buyerName: 'Say "Hi" Jewellers' })])).toContain(
      '"Say ""Hi"" Jewellers"',
    );
  });

  it("toText is readable and names the empty register honestly", () => {
    expect(toText([])).toBe("Aurum issued keys: no keys recorded yet.");
    const text = toText([row()]);
    expect(text).toContain("Ramesh Jewellers");
    expect(text).toContain("Device ID: ABCD-1234-EF01");
    expect(text).toContain("Phone model: Infinix ZERO 5G 2023");
    expect(text).toContain("Unlock key: KEY12345");
  });
});

describe("developerWhatsAppLink with phone model", () => {
  it("appends the model after the Device ID, and omits it when blank", () => {
    expect(
      developerWhatsAppLink("A1B2C3D4", "ABCD-1234-EF01", "Infinix ZERO 5G 2023"),
    ).toBe(
      "https://wa.me/916263396446?text=" +
        encodeURIComponent(
          "Namaste, Aurum activation code: A1B2C3D4. Device ID: ABCD-1234-EF01. Phone model: Infinix ZERO 5G 2023. Please send the unlock key.",
        ),
    );
    // No model → the old message is unchanged.
    expect(developerWhatsAppLink("A1B2C3D4", "ABCD-1234-EF01")).toBe(
      "https://wa.me/916263396446?text=" +
        encodeURIComponent(
          "Namaste, Aurum activation code: A1B2C3D4. Device ID: ABCD-1234-EF01. Please send the unlock key.",
        ),
    );
    expect(developerWhatsAppLink("A1B2C3D4", "ABCD-1234-EF01", "   ")).toBe(
      "https://wa.me/916263396446?text=" +
        encodeURIComponent(
          "Namaste, Aurum activation code: A1B2C3D4. Device ID: ABCD-1234-EF01. Please send the unlock key.",
        ),
    );
  });
});

describe("getDeviceModel web fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses an Android model out of a phone user agent", () => {
    expect(
      parseDeviceModelFromUserAgent(
        "Mozilla/5.0 (Linux; Android 13; Infinix X6815D) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      ),
    ).toBe("Infinix X6815D");
    expect(
      parseDeviceModelFromUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
      ),
    ).toBe("Pixel 8");
  });

  it("returns empty for a desktop user agent or a blank one", () => {
    expect(
      parseDeviceModelFromUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ),
    ).toBe("");
    expect(parseDeviceModelFromUserAgent("")).toBe("");
  });

  it("getDeviceModel uses navigator.userAgent on the web and never throws", async () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Infinix X6815D) AppleWebKit/537.36",
    });
    await expect(getDeviceModel()).resolves.toBe("Infinix X6815D");
    vi.stubGlobal("navigator", { userAgent: "" });
    await expect(getDeviceModel()).resolves.toBe("");
  });
});
