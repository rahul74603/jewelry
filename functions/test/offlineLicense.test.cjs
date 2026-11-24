/** Pure unit tests for the offline-license core (no emulator needed). Run after `npm run build`: node --test test/*.test.cjs */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeOfflineDeviceId,
  formatOfflineDeviceId,
  parseHeartbeatInput,
  parseStatusChange,
  applyHeartbeat,
  checkHeartbeatRateLimit,
  HEARTBEAT_LIMIT_PER_HOUR,
} = require("../lib/core/offlineLicense");

test("normalizeOfflineDeviceId strips dashes/spaces and uppercases", () => {
  assert.equal(normalizeOfflineDeviceId("abcd-1234-ef01"), "ABCD1234EF01");
  assert.equal(normalizeOfflineDeviceId(" abcd 1234 ef01 "), "ABCD1234EF01");
  assert.equal(formatOfflineDeviceId("abcd1234ef01"), "ABCD-1234-EF01");
  assert.throws(() => normalizeOfflineDeviceId("too-short"), /12 hex/);
  assert.throws(() => normalizeOfflineDeviceId("ZZZZ-1234-EF01"), /12 hex/);
});

test("parseHeartbeatInput validates and normalises the payload", () => {
  assert.deepEqual(
    parseHeartbeatInput({
      deviceId: "abcd-1234-ef01",
      shopName: "  Test Shop ",
      model: "Infinix X6815D",
      appVersion: "1.0.35",
    }),
    {
      deviceId: "ABCD1234EF01",
      shopName: "Test Shop",
      model: "Infinix X6815D",
      appVersion: "1.0.35",
    },
  );
  // Optional fields default to empty; missing shopName is rejected.
  assert.deepEqual(
    parseHeartbeatInput({ deviceId: "ABCD1234EF01", shopName: "Shop" }),
    {
      deviceId: "ABCD1234EF01",
      shopName: "Shop",
      model: "",
      appVersion: "",
    },
  );
  assert.throws(() => parseHeartbeatInput({ deviceId: "x", shopName: "S" }));
  assert.throws(() =>
    parseHeartbeatInput({ deviceId: "ABCD1234EF01", shopName: "" }),
  );
  assert.throws(() =>
    parseHeartbeatInput({
      deviceId: "ABCD1234EF01",
      shopName: "x".repeat(101),
    }),
  );
});

test("parseStatusChange accepts only active/blocked", () => {
  assert.deepEqual(
    parseStatusChange({ deviceId: "abcd-1234-ef01", status: "blocked" }),
    { deviceId: "ABCD1234EF01", status: "blocked" },
  );
  assert.throws(() =>
    parseStatusChange({ deviceId: "ABCD1234EF01", status: "deleted" }),
  );
});

test("applyHeartbeat creates active, counts up, never unblocks", () => {
  const now = 1_700_000_000_000;
  const input = {
    deviceId: "ABCD1234EF01",
    shopName: "Shop",
    model: "M",
    appVersion: "1.0.35",
  };
  const first = applyHeartbeat(undefined, input, now);
  assert.equal(first.status, "active");
  assert.equal(first.firstSeen, now);
  assert.equal(first.lastSeen, now);
  assert.equal(first.heartbeatCount, 1);
  const second = applyHeartbeat(first, { ...input, shopName: "Renamed" }, now + 1000);
  assert.equal(second.firstSeen, now);
  assert.equal(second.lastSeen, now + 1000);
  assert.equal(second.heartbeatCount, 2);
  assert.equal(second.shopName, "Renamed");
  const blocked = applyHeartbeat({ ...first, status: "blocked" }, input, now + 2000);
  assert.equal(blocked.status, "blocked");
});

test("checkHeartbeatRateLimit allows 20/hour then refuses, resets next hour", () => {
  const now = 1_700_000_000_000;
  let bucket;
  for (let i = 0; i < HEARTBEAT_LIMIT_PER_HOUR; i++)
    bucket = checkHeartbeatRateLimit(bucket, now);
  assert.equal(bucket.count, HEARTBEAT_LIMIT_PER_HOUR);
  assert.throws(() => checkHeartbeatRateLimit(bucket, now), /Too many/);
  const next = checkHeartbeatRateLimit(bucket, now + 60 * 60 * 1000 + 1);
  assert.equal(next.count, 1);
});
