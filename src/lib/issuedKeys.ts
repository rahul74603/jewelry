/**
 * Issued-keys register (Master app only, localStorage on Ajay's phone).
 *
 * Every unlock key Ajay generates is recorded here, so a repeat key
 * request is visible: same buyer number + new Device ID + different
 * model / different IMEI = a different phone, not a genuine reset.
 *
 * Honest limit: this register makes repeat requests VISIBLE — it does
 * not technically block resale. The key stays bound to code + Device
 * ID; the phone model is per-model, not per-phone, so it is only a
 * signal. And the register itself lives in Master-app localStorage,
 * so it is wiped if the Master app is uninstalled — export regularly.
 */

export type IssuedKeyRow = {
  /** Unique row id (random UUID). */
  id: string;
  /** ISO date-time the key was generated. */
  date: string;
  buyerName: string;
  /** Buyer WhatsApp number, as typed by Ajay. */
  buyerNumber: string;
  deviceCode: string;
  deviceId: string;
  model: string;
  /** Optional IMEI, typed manually (shopkeeper dials *#06#). */
  imei: string;
  unlockKey: string;
  note: string;
};

export const ISSUED_KEYS_STORAGE_KEY = "aurum:issued-keys-v1" as const;

export type IssuedKeyInput = Omit<IssuedKeyRow, "id" | "date"> & {
  id?: string;
  date?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function newId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      "randomUUID" in crypto &&
      typeof crypto.randomUUID === "function"
    )
      return crypto.randomUUID();
  } catch {
    // Fall through to the Math.random id below.
  }
  return `row-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Defensive row check — anything malformed is dropped, never crashes. */
function isValidRow(value: unknown): value is IssuedKeyRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.date === "string" &&
    row.date.length > 0
  );
}

function normalizeRow(value: unknown): IssuedKeyRow | null {
  if (!isValidRow(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    id: row.id as string,
    date: row.date as string,
    buyerName: asString(row.buyerName),
    buyerNumber: asString(row.buyerNumber),
    deviceCode: asString(row.deviceCode),
    deviceId: asString(row.deviceId),
    model: asString(row.model),
    imei: asString(row.imei),
    unlockKey: asString(row.unlockKey),
    note: asString(row.note),
  };
}

/** Load the register. Corrupt / missing data → empty list, never throws. */
export function loadIssuedKeys(
  storage: StorageLike | null = defaultStorage(),
): IssuedKeyRow[] {
  try {
    const raw = storage?.getItem(ISSUED_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRow)
      .filter((row): row is IssuedKeyRow => row !== null);
  } catch {
    return [];
  }
}

/** Persist the register. Failures (e.g. storage unavailable) are silent. */
export function saveIssuedKeys(
  rows: IssuedKeyRow[],
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(ISSUED_KEYS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // The register cannot persist here; the key itself was still
    // generated and shown, so this must never throw.
  }
}

/** Build a new row (newest first) from a successful key generation. */
export function addRow(
  rows: IssuedKeyRow[],
  input: IssuedKeyInput,
): IssuedKeyRow[] {
  const row: IssuedKeyRow = {
    id: input.id?.trim() || newId(),
    date: input.date?.trim() || new Date().toISOString(),
    buyerName: input.buyerName.trim(),
    buyerNumber: input.buyerNumber.trim(),
    deviceCode: input.deviceCode.trim().toUpperCase(),
    deviceId: input.deviceId.trim().toUpperCase(),
    model: input.model.trim(),
    imei: input.imei.trim(),
    unlockKey: input.unlockKey.trim().toUpperCase(),
    note: input.note.trim(),
  };
  return [row, ...rows];
}

/** Digits only — so "+91 62633 96446" and "916263396446" compare equal. */
function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/**
 * Indian mobile number, normalised for comparison: strip a leading
 * "91" country code (12 digits) or trunk "0" (11 digits), so "+91
 * 98765 43210", "09876543210" and "9876543210" are the same number.
 */
function normalizePhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** Letters + digits only, lowercased — dashes/spaces in a Device ID or
 * IMEI are ignored, so "ABCD-1234-EF01" matches "abcd1234ef01". */
function compact(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toLowerCase();
}

/**
 * Search by buyer number, Device ID or IMEI (case-insensitive, dashes
 * ignored for Device ID / IMEI). Also matches buyer name, model and
 * note text. An empty query returns every row.
 */
export function searchRows(rows: IssuedKeyRow[], query: string): IssuedKeyRow[] {
  const q = query.trim();
  if (!q) return rows;
  const qCompact = compact(q);
  const qDigits = normalizePhone(q);
  const qLower = q.toLowerCase();
  return rows.filter((row) => {
    if (qCompact && compact(row.deviceId).includes(qCompact)) return true;
    if (qCompact && row.imei && compact(row.imei).includes(qCompact))
      return true;
    if (qDigits && normalizePhone(row.buyerNumber).includes(qDigits))
      return true;
    if (row.buyerName.toLowerCase().includes(qLower)) return true;
    if (row.model.toLowerCase().includes(qLower)) return true;
    if (row.note.toLowerCase().includes(qLower)) return true;
    if (row.unlockKey.toLowerCase().includes(qLower)) return true;
    return false;
  });
}

/**
 * Ids of rows that share a buyer number with ANOTHER row whose Device
 * ID is different — the "same buyer, different phone" flag. Rows with
 * no buyer number are never flagged, and a repeat key for the SAME
 * Device ID (genuine re-issue) is not flagged either.
 */
export function flagRows(rows: IssuedKeyRow[]): Set<string> {
  const flagged = new Set<string>();
  const byNumber = new Map<string, IssuedKeyRow[]>();
  for (const row of rows) {
    const number = normalizePhone(row.buyerNumber);
    if (!number) continue;
    const list = byNumber.get(number) ?? [];
    list.push(row);
    byNumber.set(number, list);
  }
  for (const list of byNumber.values()) {
    const deviceIds = new Set(list.map((row) => compact(row.deviceId)));
    if (deviceIds.size > 1)
      for (const row of list) flagged.add(row.id);
  }
  return flagged;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Register as CSV (header + one row per key), for spreadsheet backup. */
export function toCSV(rows: IssuedKeyRow[]): string {
  const header = [
    "Date",
    "Buyer name",
    "Buyer number",
    "Device code",
    "Device ID",
    "Phone model",
    "IMEI",
    "Unlock key",
    "Note",
  ];
  const lines = rows.map((row) =>
    [
      row.date,
      row.buyerName,
      row.buyerNumber,
      row.deviceCode,
      row.deviceId,
      row.model,
      row.imei,
      row.unlockKey,
      row.note,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\n");
}

/** Register as readable plain text, one block per key. */
export function toText(rows: IssuedKeyRow[]): string {
  if (rows.length === 0) return "Aurum issued keys: no keys recorded yet.";
  const lines = ["Aurum issued keys", "==================", ""];
  for (const row of rows) {
    lines.push(
      `${row.date.slice(0, 10)} — ${row.buyerName || "(no name)"} (${row.buyerNumber || "no number"})`,
      `  Device code: ${row.deviceCode}  Device ID: ${row.deviceId}`,
      `  Phone model: ${row.model || "—"}  IMEI: ${row.imei || "—"}`,
      `  Unlock key: ${row.unlockKey}${row.note ? `  Note: ${row.note}` : ""}`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}
