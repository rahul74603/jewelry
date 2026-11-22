import { it, expect, describe } from "vitest";
import {
  emptyWorkspace,
  makeProfile,
  loanSchema,
  type Loan,
  type Workspace,
} from "../functions/src/core/model";
import {
  loanSummary,
  todayDay,
} from "../functions/src/core/loans";
import { memoryCloudStore } from "../src/lib/cloudBackup";
import {
  buildReminderItems,
  checkSmsPermission,
  loadAutoSmsSettings,
  loadAutoSmsStatus,
  loadSentLog,
  normalizeSmsPhone,
  prepareAutoSms,
  requestSmsPermission,
  saveAutoSmsSettings,
  sendTestSms,
  sentTodayLoanIds,
  smsFailureText,
  type SmsReminderNative,
  type SmsSentEntry,
} from "../src/lib/autoSms";

const TODAY = todayDay();
const dayISO = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function fakeNative(impl: Partial<SmsReminderNative> = {}): SmsReminderNative {
  return {
    checkPermission: async () => ({ granted: true }),
    requestPermission: async () => ({ granted: true }),
    scheduleReminders: async () => ({
      scheduled: true,
      count: 0,
      mode: "exact",
      exactAllowed: true,
    }),
    cancelReminders: async () => ({ cancelled: true }),
    sendNow: async () => ({ sent: true }),
    getSentLog: async () => ({ entries: [] }),
    getStatus: async () => ({
      enabled: false,
      mode: "",
      exactAllowed: true,
      smsGranted: true,
    }),
    openBatterySettings: async () => {},
    openExactAlarmSettings: async () => {},
    ...impl,
  };
}

function loan(over: Partial<Loan> = {}): Loan {
  return loanSchema.parse({
    id: "loan-test-1",
    kind: "girvi",
    customerId: "client-0",
    itemName: "Gold necklace 22K",
    itemMetal: "Gold",
    itemPurity: "22K",
    itemWeight: 12.5,
    principalPaise: 2000000,
    totalPaise: 2000000,
    upfrontPaise: 0,
    interestRatePct: 2,
    startAt: dayISO(-75),
    dueAt: dayISO(-5),
    payments: [],
    status: "active",
    createdAt: dayISO(-75) + "T06:30:00.000Z",
    ...over,
  });
}

function workspace(): Workspace {
  const w = emptyWorkspace(makeProfile("Test Jewellers", "Test Owner", ""));
  w.customers = [
    { id: "client-0", name: "Meera Sharma", phone: "9876543210", address: "", email: "", gstin: "" },
    { id: "client-1", name: "Arjun Mehta", phone: "+91 98220 12345", address: "", email: "", gstin: "" },
    { id: "client-2", name: "Priya Patel", phone: "", address: "", email: "", gstin: "" },
    { id: "client-3", name: "Ananya Gupta", phone: "98", address: "", email: "", gstin: "" },
  ];
  w.loans = [
    // Overdue girvi, phone — in the payload, first.
    loan({ id: "loan-overdue", customerId: "client-0" }),
    // Due-soon girvi, phone with +91 and spaces — normalised.
    loan({
      id: "loan-soon",
      customerId: "client-1",
      principalPaise: 5000000,
      totalPaise: 5000000,
      startAt: dayISO(-40),
      dueAt: dayISO(3),
    }),
    // Due-soon girvi, no phone — reported, never messaged.
    loan({
      id: "loan-nophone",
      customerId: "client-2",
      principalPaise: 3000000,
      totalPaise: 3000000,
      startAt: dayISO(-40),
      dueAt: dayISO(3),
    }),
    // Due-soon girvi, unusable number — reported, never messaged.
    loan({
      id: "loan-badphone",
      customerId: "client-3",
      principalPaise: 3000000,
      totalPaise: 3000000,
      startAt: dayISO(-40),
      dueAt: dayISO(3),
    }),
    // Active, due in 30 days — not due yet.
    loan({
      id: "loan-active",
      customerId: "client-0",
      principalPaise: 1000000,
      totalPaise: 1000000,
      startAt: dayISO(-10),
      dueAt: dayISO(30),
    }),
    // Settled — never in the due list.
    loan({
      id: "loan-settled",
      customerId: "client-0",
      principalPaise: 1000000,
      totalPaise: 1000000,
      startAt: dayISO(-60),
      dueAt: dayISO(-5),
      status: "settled",
      settledAt: dayISO(-2) + "T06:30:00.000Z",
      settlementAmountPaise: 500000,
      waivedPaise: 500000,
    }),
    // Forfeited — never in the due list.
    loan({
      id: "loan-forfeited",
      customerId: "client-0",
      principalPaise: 1000000,
      totalPaise: 1000000,
      startAt: dayISO(-60),
      dueAt: dayISO(-5),
      status: "forfeited",
      forfeitedAt: dayISO(-2) + "T06:30:00.000Z",
    }),
  ];
  return w;
}

describe("normalizeSmsPhone", () => {
  it("normalises 10-digit numbers to +91", () => {
    expect(normalizeSmsPhone("9876543210")).toBe("+919876543210");
    expect(normalizeSmsPhone("09876543210")).toBe("+919876543210");
    expect(normalizeSmsPhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeSmsPhone("919876543210")).toBe("+919876543210");
  });
  it("rejects unusable numbers instead of inventing one", () => {
    expect(normalizeSmsPhone("")).toBeNull();
    expect(normalizeSmsPhone("98")).toBeNull();
    expect(normalizeSmsPhone("abc")).toBeNull();
  });
});

describe("smsFailureText", () => {
  it("explains the native reason codes", () => {
    expect(smsFailureText("no-service")).toContain("No mobile network");
    expect(smsFailureText("radio-off")).toContain("airplane");
    expect(smsFailureText("null-pdu")).toContain("number");
    expect(smsFailureText("unknown")).toContain("dobara try");
    expect(smsFailureText(null)).toContain("nahi gaya");
  });
});

describe("buildReminderItems", () => {
  it("includes only due loans with a usable phone, overdue first", () => {
    const w = workspace();
    const { items, noPhone } = buildReminderItems(
      w.loans,
      w.customers,
      w.profile.shopName,
      TODAY,
    );
    expect(items.map((i) => i.loanId)).toEqual(["loan-overdue", "loan-soon"]);
    expect(items[0].phone).toBe("+919876543210");
    expect(items[1].phone).toBe("+919822012345");
    expect(items[0].dueDay).toBe(dayISO(-5));
    expect(noPhone.map((n) => n.loanId)).toEqual([
      "loan-nophone",
      "loan-badphone",
    ]);
  });
  it("reuses the reminder message (month-wise interest, kul total)", () => {
    const w = workspace();
    const { items } = buildReminderItems(
      w.loans,
      w.customers,
      w.profile.shopName,
      TODAY,
    );
    const s = loanSummary(w.loans[0], TODAY);
    expect(s.outstandingInterestPaise).toBeGreaterThan(0);
    expect(items[0].message).toContain("Namaste Meera Sharma ji");
    expect(items[0].message).toContain("bakaya hai");
    expect(items[0].message).toContain("kul");
  });
  it("skips records already messaged today (dedup, JS layer)", () => {
    const w = workspace();
    const { items } = buildReminderItems(
      w.loans,
      w.customers,
      w.profile.shopName,
      TODAY,
      new Set(["loan-overdue"]),
    );
    expect(items.map((i) => i.loanId)).toEqual(["loan-soon"]);
  });
});

describe("sentTodayLoanIds", () => {
  const entry = (over: Partial<SmsSentEntry> = {}): SmsSentEntry => ({
    loanId: "loan-overdue",
    customerName: "Meera Sharma",
    phone: "+919876543210",
    message: "test",
    sentAt: new Date().toISOString(),
    sentDay: TODAY,
    status: "sent",
    ...over,
  });
  it("counts sent and sending, not failed", () => {
    const ids = sentTodayLoanIds([
      entry({ loanId: "a" }),
      entry({ loanId: "b", status: "sending" }),
      entry({ loanId: "c", status: "failed", reason: "no-service" }),
      entry({ loanId: "d", sentDay: "2020-01-01" }),
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("auto-SMS settings", () => {
  it("defaults OFF and round-trips", () => {
    const { store } = memoryCloudStore();
    expect(loadAutoSmsSettings(store)).toEqual({ enabled: false });
    saveAutoSmsSettings({ enabled: true }, store);
    expect(loadAutoSmsSettings(store)).toEqual({ enabled: true });
    saveAutoSmsSettings({ enabled: false }, store);
    expect(loadAutoSmsSettings(store)).toEqual({ enabled: false });
  });
  it("a corrupt setting stays OFF", () => {
    const { store, map } = memoryCloudStore();
    map.set("aurum:sms:auto", "{not json");
    expect(loadAutoSmsSettings(store)).toEqual({ enabled: false });
  });
});

describe("prepareAutoSms", () => {
  it("does nothing when disabled", async () => {
    const { store } = memoryCloudStore();
    const native = fakeNative({
      scheduleReminders: async () => {
        throw Error("must not be called");
      },
    });
    const result = await prepareAutoSms(workspace(), native, store);
    expect(result).toEqual({ prepared: false, reason: "disabled" });
  });
  it("hands the due payload to the native scheduler when enabled", async () => {
    const { store } = memoryCloudStore();
    saveAutoSmsSettings({ enabled: true }, store);
    let seen: { items: unknown; preparedDay: string } | null = null;
    const native = fakeNative({
      scheduleReminders: async (options) => {
        seen = options;
        return {
          scheduled: true,
          count: options.items.length,
          mode: "periodic",
          exactAllowed: false,
        };
      },
    });
    const result = await prepareAutoSms(workspace(), native, store);
    expect(result).toEqual({
      prepared: true,
      count: 2,
      mode: "periodic",
      exactAllowed: false,
    });
    expect(seen?.preparedDay).toBe(TODAY);
    expect(
      (seen?.items as { loanId: string }[]).map((i) => i.loanId),
    ).toEqual(["loan-overdue", "loan-soon"]);
  });
  it("reports a missing SMS permission instead of throwing", async () => {
    const { store } = memoryCloudStore();
    saveAutoSmsSettings({ enabled: true }, store);
    const native = fakeNative({
      scheduleReminders: async () => {
        throw Error("sms-permission-missing");
      },
    });
    const result = await prepareAutoSms(workspace(), native, store);
    expect(result).toEqual({ prepared: false, reason: "no-permission" });
  });
  it("reports a generic scheduler failure instead of throwing", async () => {
    const { store } = memoryCloudStore();
    saveAutoSmsSettings({ enabled: true }, store);
    const native = fakeNative({
      scheduleReminders: async () => {
        throw Error("schedule-failed");
      },
    });
    const result = await prepareAutoSms(workspace(), native, store);
    expect(result).toEqual({ prepared: false, reason: "failed" });
  });
});

describe("sent log and status", () => {
  it("loads the native log and maps the mode", async () => {
    const entries: SmsSentEntry[] = [
      {
        loanId: "loan-overdue",
        customerName: "Meera Sharma",
        phone: "+919876543210",
        message: "test",
        sentAt: new Date().toISOString(),
        sentDay: TODAY,
        status: "failed",
        reason: "no-service",
        retryPending: true,
      },
    ];
    const native = fakeNative({
      getSentLog: async () => ({ entries }),
      getStatus: async () => ({
        enabled: true,
        mode: "exact",
        exactAllowed: true,
        smsGranted: true,
      }),
    });
    expect(await loadSentLog(native)).toEqual(entries);
    expect(await loadAutoSmsStatus(native)).toEqual({
      enabled: true,
      mode: "exact",
      exactAllowed: true,
      smsGranted: true,
    });
  });
  it("returns empty / null when the native side is unavailable", async () => {
    const native = fakeNative({
      getSentLog: async () => {
        throw Error("log-unavailable");
      },
      getStatus: async () => {
        throw Error("unavailable");
      },
    });
    expect(await loadSentLog(native)).toEqual([]);
    expect(await loadAutoSmsStatus(native)).toBeNull();
  });
});

describe("permission and test SMS", () => {
  it("passes the permission result through", async () => {
    const granted = fakeNative();
    expect(await checkSmsPermission(granted)).toEqual({ granted: true });
    expect(await requestSmsPermission(granted)).toEqual({ granted: true });
    const denied = fakeNative({
      checkPermission: async () => ({ granted: false }),
      requestPermission: async () => ({ granted: false }),
    });
    expect(await checkSmsPermission(denied)).toEqual({ granted: false });
    expect(await requestSmsPermission(denied)).toEqual({ granted: false });
  });
  it("sends a test SMS to the shop number, normalised", async () => {
    let seen: { phone: string; message: string } | null = null;
    const native = fakeNative({
      sendNow: async (options) => {
        seen = options;
        return { sent: true };
      },
    });
    expect(await sendTestSms("9876543210", "Test Jewellers", native)).toEqual({
      sent: true,
    });
    expect(seen?.phone).toBe("+919876543210");
    expect(seen?.message).toContain("Test Jewellers");
  });
  it("refuses a test SMS without a usable number", async () => {
    const native = fakeNative({
      sendNow: async () => {
        throw Error("must not be called");
      },
    });
    expect(await sendTestSms("", "Test Jewellers", native)).toEqual({
      sent: false,
    });
  });
});
