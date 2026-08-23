import assert from "node:assert/strict";
import test from "node:test";
import { computeOperationsHealth, latestTimestamp } from "./operations-health.ts";

test("healthy inventory has no attention or integrity issues", () => {
  const health = computeOperationsHealth({ commerceRecords: [], soldActiveCuttingIds: [], archivedCuttingIds: ["C1"], outgoingCuttingIds: ["C1"] });
  assert.equal(health.attentionCount, 0);
  assert.equal(health.integrityIssueCount, 0);
});

test("detects both directions of inventory-history drift", () => {
  const health = computeOperationsHealth({ commerceRecords: [], soldActiveCuttingIds: [], archivedCuttingIds: ["ARCHIVED-ONLY", "GOOD"], outgoingCuttingIds: ["OUTGOING-ONLY", "GOOD"] });
  assert.deepEqual(health.archivedWithoutOutgoing, ["ARCHIVED-ONLY"]);
  assert.deepEqual(health.outgoingWithoutArchive, ["OUTGOING-ONLY"]);
  assert.equal(health.integrityIssueCount, 2);
});

test("sold active cuttings are work awaiting reviewed disposition", () => {
  const health = computeOperationsHealth({ commerceRecords: [], soldActiveCuttingIds: ["C2", "C1", "C1"], archivedCuttingIds: [], outgoingCuttingIds: [] });
  assert.deepEqual(health.soldAwaitingDisposition, ["C1", "C2"]);
  assert.equal(health.attentionCount, 2);
});

test("stale commerce handoffs contribute to attention", () => {
  const health = computeOperationsHealth({
    commerceRecords: [{ sourceRecordId: "C1", plantRecordType: "cutting", commerceSelectedAt: "2026-08-01T00:00:00Z", commerceAcknowledgedAt: null }],
    soldActiveCuttingIds: [], archivedCuttingIds: [], outgoingCuttingIds: [], now: new Date("2026-08-23T00:00:00Z"),
  });
  assert.equal(health.commerce.waitingLongCount, 1);
  assert.equal(health.attentionCount, 1);
});

test("latestTimestamp ignores missing and invalid values", () => {
  assert.equal(latestTimestamp([null, "invalid", "2026-08-20T00:00:00Z", "2026-08-22T00:00:00Z"]), "2026-08-22T00:00:00Z");
  assert.equal(latestTimestamp([null, undefined, "bad"]), null);
});
