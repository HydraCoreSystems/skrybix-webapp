import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCommerceHandoffHealth,
  HANDOFF_WAITING_LONG_THRESHOLD_MS,
  type CommerceHandoffRecord,
} from "./commerce-health.ts";

function record(overrides: Partial<CommerceHandoffRecord>): CommerceHandoffRecord {
  return {
    sourceRecordId: "M-TEST01-C01",
    plantRecordType: "cutting",
    commerceSelectedAt: null,
    commerceAcknowledgedAt: null,
    ...overrides,
  };
}

test("computeCommerceHandoffHealth: unselected records are excluded entirely", () => {
  const health = computeCommerceHandoffHealth([record({})]);
  assert.equal(health.waitingCount, 0);
  assert.equal(health.acknowledgedCount, 0);
  assert.equal(health.waitingLongCount, 0);
});

test("computeCommerceHandoffHealth: selected-not-acknowledged counts as waiting", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const health = computeCommerceHandoffHealth(
    [record({ commerceSelectedAt: "2026-08-22T10:00:00.000Z" })],
    now
  );
  assert.equal(health.waitingCount, 1);
  assert.equal(health.acknowledgedCount, 0);
  assert.equal(health.waitingLongCount, 0);
});

test("computeCommerceHandoffHealth: acknowledged records are never double-counted as waiting", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const health = computeCommerceHandoffHealth(
    [
      record({
        commerceSelectedAt: "2026-08-20T00:00:00.000Z",
        commerceAcknowledgedAt: "2026-08-20T01:00:00.000Z",
      }),
    ],
    now
  );
  assert.equal(health.waitingCount, 0);
  assert.equal(health.acknowledgedCount, 1);
  assert.equal(health.waitingLongCount, 0);
});

test("computeCommerceHandoffHealth: waiting exactly at the threshold counts as waiting-long (>=, not >)", () => {
  const selectedAt = new Date("2026-08-20T00:00:00.000Z");
  const now = new Date(selectedAt.getTime() + HANDOFF_WAITING_LONG_THRESHOLD_MS);
  const health = computeCommerceHandoffHealth(
    [record({ sourceRecordId: "M-EDGE01-C01", commerceSelectedAt: selectedAt.toISOString() })],
    now
  );
  assert.equal(health.waitingLongCount, 1);
  assert.equal(health.waitingLongRecords[0].sourceRecordId, "M-EDGE01-C01");
});

test("computeCommerceHandoffHealth: just under the threshold does not count as waiting-long", () => {
  const selectedAt = new Date("2026-08-20T00:00:00.000Z");
  const now = new Date(selectedAt.getTime() + HANDOFF_WAITING_LONG_THRESHOLD_MS - 1);
  const health = computeCommerceHandoffHealth(
    [record({ commerceSelectedAt: selectedAt.toISOString() })],
    now
  );
  assert.equal(health.waitingLongCount, 0);
});

test("computeCommerceHandoffHealth: waiting-long records are sorted oldest-selection-first", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const health = computeCommerceHandoffHealth(
    [
      record({ sourceRecordId: "NEWER", commerceSelectedAt: "2026-08-19T00:00:00.000Z" }),
      record({ sourceRecordId: "OLDEST", commerceSelectedAt: "2026-08-15T00:00:00.000Z" }),
      record({ sourceRecordId: "MIDDLE", commerceSelectedAt: "2026-08-17T00:00:00.000Z" }),
    ],
    now
  );
  assert.deepEqual(
    health.waitingLongRecords.map((r) => r.sourceRecordId),
    ["OLDEST", "MIDDLE", "NEWER"]
  );
});

test("computeCommerceHandoffHealth: mixes cuttings and mothers in one set of totals", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const health = computeCommerceHandoffHealth(
    [
      record({ plantRecordType: "cutting", commerceSelectedAt: "2026-08-22T10:00:00.000Z" }),
      record({ plantRecordType: "mother", sourceRecordId: "M-TEST01", commerceSelectedAt: "2026-08-22T10:00:00.000Z" }),
    ],
    now
  );
  assert.equal(health.waitingCount, 2);
});
