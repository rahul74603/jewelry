/**
 * Automatic daily SMS reminders for due girvi / EMI records, sent at
 * 10:00 AM from the shopkeeper's own SIM.
 *
 * How it works: the loans live in the app's JS store, which a native
 * background worker cannot read. So every time the app opens, the JS
 * side computes the due reminders (the same dueLoans() +
 * reminderMessage() as the on-screen list) and hands the payload —
 * record id, customer phone, message text — to the native SmsReminder
 * plugin, which stores it in SharedPreferences. A native trigger
 * fires at 10:00 AM (Asia/Kolkata) and sends each stored SMS once
 * via the phone's own SIM (SmsManager, multipart for long messages).
 * The in-app due list stays as the fallback.
 *
 * The 10:00 trigger is an exact alarm (AlarmManager
 * setExactAndAllowWhileIdle) when the phone allows exact alarms, and
 * WorkManager periodic work (24h, initial delay to 10:00) when it
 * does not. Even the exact alarm is best-effort on some phones
 * (Infinix/Xiaomi battery saving and autostart) — see docs/girvi-emi.md.
 *
 * One SMS per record per day, enforced twice: the JS payload skips
 * records already messaged today (from the native sent log), and the
 * native worker keeps a last-sent day per record — set only after
 * the radio confirms the SMS went out, never on a failure.
 *
 * Retry / catch-up: a failed send is never marked sent. A transient
 * failure (no signal, radio off) makes the worker return
 * Result.retry() (30-minute linear backoff), so it tries again later
 * the same day; a permanent failure (bad number) does not retry.
 * Anything still unsent is picked up by the next day's 10:00 run —
 * the record stays due until it is paid, so reminders repeat daily,
 * never monthly. Failed attempts stay in the sent log as failed with
 * retry pending. SMS needs a mobile signal, not the internet.
 *
 * No automatic WhatsApp: the WhatsApp Business API charges per
 * message and unofficial automation gets the number banned — SMS
 * from the shopkeeper's own SIM is the free automatic channel.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  dueLoans,
  reminderMessage,
  todayDay,
} from "../../functions/src/core/loans";
import type {
  Customer,
  Loan,
  Workspace,
} from "../../functions/src/core/model";
import { localKvStore, type KvStore } from "./kvStore";

export type SmsScheduleMode = "exact" | "periodic";

export type SmsReminderItem = {
  loanId: string;
  customerName: string;
  phone: string;
  message: string;
  dueDay: string;
};

export type SmsSentStatus = "sending" | "sent" | "failed";

export type SmsSentEntry = {
  loanId: string;
  customerName: string;
  phone: string;
  message: string;
  sentAt: string;
  sentDay: string;
  status: SmsSentStatus;
  reason?: string;
  /** True while a failed transient send is still waiting for its retry. */
  retryPending?: boolean;
  sendId?: string;
};

export type AutoSmsSettings = { enabled: boolean };

export interface SmsReminderNative {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  scheduleReminders(options: {
    items: SmsReminderItem[];
    preparedDay: string;
  }): Promise<{
    scheduled: boolean;
    count: number;
    mode: string;
    exactAllowed: boolean;
  }>;
  cancelReminders(): Promise<{ cancelled: boolean }>;
  sendNow(options: {
    phone: string;
    message: string;
    customerName?: string;
  }): Promise<{ sent: boolean }>;
  getSentLog(): Promise<{ entries: SmsSentEntry[] }>;
  getStatus(): Promise<{
    enabled: boolean;
    mode: string;
    exactAllowed: boolean;
    smsGranted: boolean;
  }>;
  openBatterySettings(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
}

const smsReminder = registerPlugin<SmsReminderNative>("SmsReminder");

const SETTINGS_KEY = "aurum:sms:auto";

/** True only in the Android app — SMS sending needs the native plugin. */
export function isAutoSmsSupported(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * The real native plugin is only usable on Android; tests inject a
 * fake, which must be allowed through on any platform.
 */
function nativeUsable(native: SmsReminderNative): boolean {
  return native !== smsReminder || Capacitor.getPlatform() === "android";
}

/** Normalise an Indian mobile number for SmsManager: "+91" + 10 digits. */
export function normalizeSmsPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

/** Friendly text for a failed SMS (native reason codes). */
export function smsFailureText(reason: string | null | undefined): string {
  switch (reason) {
    case "no-service":
      return "No mobile network — SMS nahi gaya";
    case "radio-off":
      return "Mobile radio off (airplane mode?) — SMS nahi gaya";
    case "null-pdu":
      return "SMS nahi bana — number check karen";
    case "generic-failure":
      return "SMS nahi gaya — dobara try karen";
    case "sms-permission-missing":
      return "SMS permission nahi hai";
    case "send-failed":
      return "SMS bhejte time error aaya";
    case "unknown":
      return "SMS ka result nahi mila — dobara try hoga";
    default:
      return reason ? reason : "SMS nahi gaya";
  }
}

export function loadAutoSmsSettings(
  store: KvStore = localKvStore,
): AutoSmsSettings {
  try {
    const parsed: unknown = JSON.parse(store.get(SETTINGS_KEY) ?? "null");
    if (parsed && typeof parsed === "object")
      return { enabled: (parsed as Partial<AutoSmsSettings>).enabled === true };
  } catch {
    // Corrupt settings — auto-SMS stays off.
  }
  return { enabled: false };
}

export function saveAutoSmsSettings(
  settings: AutoSmsSettings,
  store: KvStore = localKvStore,
): void {
  store.set(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Build the reminder payload for the native scheduler: due loans
 * (overdue first, then due within 7 days) with a usable phone number,
 * excluding records already messaged today. Records without a number
 * come back in `noPhone` so the UI can say so instead of silently
 * dropping them.
 */
export function buildReminderItems(
  loans: Loan[],
  customers: Customer[],
  shopName: string,
  asOfDay: string = todayDay(),
  sentToday: ReadonlySet<string> = new Set(),
): {
  items: SmsReminderItem[];
  noPhone: { loanId: string; customerName: string }[];
} {
  const items: SmsReminderItem[] = [];
  const noPhone: { loanId: string; customerName: string }[] = [];
  for (const loan of dueLoans(loans, asOfDay)) {
    const customer = customers.find((c) => c.id === loan.customerId);
    const customerName = customer?.name ?? "Unknown customer";
    if (sentToday.has(loan.id)) continue;
    const phone = customer ? normalizeSmsPhone(customer.phone ?? "") : null;
    if (!phone) {
      noPhone.push({ loanId: loan.id, customerName });
      continue;
    }
    items.push({
      loanId: loan.id,
      customerName,
      phone,
      message: reminderMessage(loan, customerName, shopName, asOfDay),
      dueDay: loan.dueAt,
    });
  }
  return { items, noPhone };
}

/** Loan ids messaged today (sent or still sending) from the native log. */
export function sentTodayLoanIds(
  entries: SmsSentEntry[],
  asOfDay: string = todayDay(),
): Set<string> {
  return new Set(
    entries
      .filter((e) => e.sentDay === asOfDay && e.status !== "failed")
      .map((e) => e.loanId),
  );
}

export type PrepareAutoSmsResult =
  | {
      prepared: false;
      reason: "disabled" | "unsupported" | "no-permission" | "failed";
    }
  | {
      prepared: true;
      count: number;
      mode: SmsScheduleMode;
      exactAllowed: boolean;
    };

/**
 * Hand today's due reminders to the native scheduler. Best-effort —
 * never throws, never breaks the app open flow. Call on every app
 * open (and when the toggle is switched on) so the payload stays
 * fresh: a payment can only be recorded by opening the app, which
 * refreshes the payload, so a paid record is never messaged twice.
 */
export async function prepareAutoSms(
  data: Workspace,
  native: SmsReminderNative = smsReminder,
  store: KvStore = localKvStore,
): Promise<PrepareAutoSmsResult> {
  if (!loadAutoSmsSettings(store).enabled)
    return { prepared: false, reason: "disabled" };
  if (!nativeUsable(native)) return { prepared: false, reason: "unsupported" };
  try {
    const log = await loadSentLog(native);
    const { items } = buildReminderItems(
      data.loans ?? [],
      data.customers ?? [],
      data.profile.shopName,
      todayDay(),
      sentTodayLoanIds(log),
    );
    const result = await native.scheduleReminders({
      items,
      preparedDay: todayDay(),
    });
    const mode: SmsScheduleMode =
      result.mode === "exact" ? "exact" : "periodic";
    return {
      prepared: true,
      count: result.count,
      mode,
      exactAllowed: result.exactAllowed,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("sms-permission-missing"))
      return { prepared: false, reason: "no-permission" };
    return { prepared: false, reason: "failed" };
  }
}

/** The native sent log (newest first). Empty on web or when unavailable. */
export async function loadSentLog(
  native: SmsReminderNative = smsReminder,
): Promise<SmsSentEntry[]> {
  if (!nativeUsable(native)) return [];
  try {
    const result = await native.getSentLog();
    return Array.isArray(result.entries) ? result.entries : [];
  } catch {
    return [];
  }
}

export type AutoSmsStatus = {
  enabled: boolean;
  mode: SmsScheduleMode | null;
  exactAllowed: boolean;
  smsGranted: boolean;
};

export async function loadAutoSmsStatus(
  native: SmsReminderNative = smsReminder,
): Promise<AutoSmsStatus | null> {
  if (!nativeUsable(native)) return null;
  try {
    const s = await native.getStatus();
    return {
      enabled: s.enabled,
      mode:
        s.mode === "exact"
          ? "exact"
          : s.mode === "periodic"
            ? "periodic"
            : null,
      exactAllowed: s.exactAllowed,
      smsGranted: s.smsGranted,
    };
  } catch {
    return null;
  }
}

/** Ask for the SMS runtime permission. Call ONLY from the settings toggle — never on app launch. */
export async function requestSmsPermission(
  native: SmsReminderNative = smsReminder,
): Promise<{ granted: boolean }> {
  if (!nativeUsable(native)) return { granted: false };
  try {
    return await native.requestPermission();
  } catch {
    return { granted: false };
  }
}

export async function checkSmsPermission(
  native: SmsReminderNative = smsReminder,
): Promise<{ granted: boolean }> {
  if (!nativeUsable(native)) return { granted: false };
  try {
    return await native.checkPermission();
  } catch {
    return { granted: false };
  }
}

/** Stop the scheduler and forget the stored payload. */
export async function cancelAutoSms(
  native: SmsReminderNative = smsReminder,
): Promise<void> {
  if (!nativeUsable(native)) return;
  try {
    await native.cancelReminders();
  } catch {
    // Already stopped — the toggle is off either way.
  }
}

/** Send one test SMS to the shop's own number, to prove SMS works. */
export async function sendTestSms(
  phone: string,
  shopName: string,
  native: SmsReminderNative = smsReminder,
): Promise<{ sent: boolean }> {
  const to = normalizeSmsPhone(phone);
  if (!to || !nativeUsable(native)) return { sent: false };
  try {
    const result = await native.sendNow({
      phone: to,
      message:
        `Aurum test SMS — ${shopName} se automatic reminder ON hai. ` +
        `Roz subah 10 baje due girvi / EMI customers ko SMS jayega.`,
      customerName: "Test SMS",
    });
    return { sent: result.sent };
  } catch {
    return { sent: false };
  }
}

export async function openBatteryOptimizationSettings(
  native: SmsReminderNative = smsReminder,
): Promise<void> {
  if (!nativeUsable(native)) return;
  try {
    await native.openBatterySettings();
  } catch {
    // Settings screen unavailable — the hint stays on screen.
  }
}

export async function openExactAlarmSettings(
  native: SmsReminderNative = smsReminder,
): Promise<void> {
  if (!nativeUsable(native)) return;
  try {
    await native.openExactAlarmSettings();
  } catch {
    // Settings screen unavailable — the hint stays on screen.
  }
}
