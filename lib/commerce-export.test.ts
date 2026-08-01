import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommerceExport,
  isCommerceExportRequestAuthorized,
  selectCommerceRecord,
  type CommerceSelectionSource,
} from "./commerce-export.ts";

test("commerce selection is durable and idempotent", async () => {
  const rows = new Map<string, CommerceSelectionSource>([
    [
      "HY-ABC01-C01",
      {
        cutting_id: "HY-ABC01-C01",
        commerce_selected_at: null,
        commerce_acknowledged_at: null,
      },
    ],
  ]);
  const repository = {
    async claimUnselected(cuttingId: string, selectedAt: string) {
      const row = rows.get(cuttingId);
      if (!row || row.commerce_selected_at) {
        return { record: null, error: null };
      }
      const selected = { ...row, commerce_selected_at: selectedAt };
      rows.set(cuttingId, selected);
      return { record: selected, error: null };
    },
    async findById(cuttingId: string) {
      return { record: rows.get(cuttingId) ?? null, error: null };
    },
  };

  const firstSelection = await selectCommerceRecord(repository, "HY-ABC01-C01", "2026-08-01T00:00:00.000Z");
  const secondSelection = await selectCommerceRecord(repository, "HY-ABC01-C01", "2026-08-02T00:00:00.000Z");

  assert.equal(firstSelection.error, null);
  assert.equal(firstSelection.alreadySelected, false);
  assert.equal(secondSelection.error, null);
  assert.equal(secondSelection.alreadySelected, true);
  assert.equal(rows.get("HY-ABC01-C01")?.commerce_selected_at, "2026-08-01T00:00:00.000Z");
});

test("authenticated commerce export returns selected records only", () => {
  const handoff = createCommerceExport(
    [
      {
        cutting_id: "HY-ABC01-C01",
        mother_id: "HY-ABC01",
        full_display_name: "Hoya example",
        sold: false,
        archived_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        commerce_selected_at: "2026-08-01T00:00:00.000Z",
        commerce_acknowledged_at: null,
      },
      {
        cutting_id: "HY-ABC01-C02",
        mother_id: "HY-ABC01",
        full_display_name: "Unselected Hoya",
        sold: false,
        archived_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        commerce_selected_at: null,
        commerce_acknowledged_at: null,
      },
      {
        cutting_id: "HY-ABC01-C03",
        mother_id: "HY-ABC01",
        full_display_name: "Acknowledged Hoya",
        sold: true,
        archived_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        commerce_selected_at: "2026-07-31T00:00:00.000Z",
        commerce_acknowledged_at: "2026-08-01T01:00:00.000Z",
      },
    ],
    "2026-08-01T02:00:00.000Z"
  );

  assert.equal(isCommerceExportRequestAuthorized("Bearer handoff-token", "handoff-token"), true);
  assert.equal(isCommerceExportRequestAuthorized("Bearer wrong-token", "handoff-token"), false);
  assert.equal(isCommerceExportRequestAuthorized(null, "handoff-token"), false);
  assert.deepEqual(handoff, {
    exportVersion: "1.0",
    sourceSystem: "skrybix",
    retrievedAt: "2026-08-01T02:00:00.000Z",
    records: [
      {
        sourceSystem: "skrybix",
        sourceRecordId: "HY-ABC01-C01",
        sku: "HY-ABC01-C01",
        displayName: "Hoya example",
        parentSourceRecordId: "HY-ABC01",
        plantRecordType: "cutting",
        state: "active",
        selectionState: "selected",
        selectedAt: "2026-08-01T00:00:00.000Z",
        acknowledgedAt: null,
        archivedAt: null,
        sourceCreatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  });
});
