import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommerceExport,
  isCommerceExportRequestAuthorized,
  normalizeCuttingForCommerce,
  normalizeMotherForCommerce,
  type CuttingCommerceSource,
  type MotherCommerceSource,
} from "./commerce-export.ts";
import { validateGenusCode, validatePlantCode } from "./commerce-sku.ts";

// The SQL-level guarantees (atomic mother/cutting SKU allocation,
// database-enforced immutability, concurrent selection never allocating
// duplicate sequences or side-effect-selecting a mother, registry
// rename/delete protection) live in Postgres functions/constraints, not
// in this JS module -- they were verified directly against a real local
// Postgres 16 instance before this file was written (every scenario in
// the owner's required-tests list that's a database concern, not a pure-
// function concern). See docs/Skrybix_Commerce_SKU_Design_Report.md and
// the implementation report for the exact commands and output. What
// belongs here is the pure-function layer: export shaping, fail-closed
// behavior, and the sourceRecordId/sku distinction.

test("sourceRecordId and sku are demonstrably different values", () => {
  const cutting: CuttingCommerceSource = {
    cutting_id: "HY-KRQ01-C01",
    mother_id: "HY-KRQ01",
    full_display_name: "Hoya krohniana",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
  };

  const record = normalizeCuttingForCommerce(cutting, "HY-KRQ-01-C01");

  assert.equal(record.sourceRecordId, "HY-KRQ01-C01");
  assert.equal(record.sku, "HY-KRQ-01-C01");
  assert.notEqual(record.sourceRecordId, record.sku);
});

test("a source record ID containing a real space remains valid and is never rewritten", () => {
  // Confirmed real production case (not fabricated) -- see the design
  // report's material-conflict check.
  const mother: MotherCommerceSource = {
    mother_id: "HY-AH 05",
    display_name: "Hoya AH Black Magic",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
  };

  const record = normalizeMotherForCommerce(mother, "HY-ABH-01");

  assert.equal(record.sourceRecordId, "HY-AH 05");
  assert.equal(record.sku, "HY-ABH-01");
});

test("fails closed: a selected record with no resolvable SKU is never exported with a fallback sku", () => {
  const cutting: CuttingCommerceSource = {
    cutting_id: "HY-KRQ01-C01",
    mother_id: "HY-KRQ01",
    full_display_name: "Hoya krohniana",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
  };

  assert.throws(() => normalizeCuttingForCommerce(cutting, null), /no assigned commerce SKU/);
  assert.throws(() => normalizeCuttingForCommerce(cutting, undefined), /no assigned commerce SKU/);
  assert.throws(() => normalizeCuttingForCommerce(cutting, ""), /no assigned commerce SKU/);

  const mother: MotherCommerceSource = {
    mother_id: "HY-AH 05",
    display_name: "x",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
  };
  assert.throws(() => normalizeMotherForCommerce(mother, null), /no assigned commerce SKU/);
});

test("mixed mother/cutting response: both record types export correctly in one payload with distinct SKUs", () => {
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
    [
      {
        mother_id: "HY-XYZ01",
        display_name: "Hoya whole-mother example",
        sold: false,
        archived_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        commerce_selected_at: "2026-08-01T00:30:00.000Z",
        commerce_acknowledged_at: null,
      },
      {
        mother_id: "HY-XYZ02",
        display_name: "Unselected mother",
        sold: false,
        archived_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        commerce_selected_at: null,
        commerce_acknowledged_at: null,
      },
    ],
    new Map([
      ["HY-ABC01-C01", "HY-ABC-01-C01"],
      ["HY-XYZ01", "HY-XYZ-01"],
    ]),
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
        sku: "HY-ABC-01-C01",
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
      {
        sourceSystem: "skrybix",
        sourceRecordId: "HY-XYZ01",
        sku: "HY-XYZ-01",
        displayName: "Hoya whole-mother example",
        parentSourceRecordId: null,
        plantRecordType: "mother",
        state: "active",
        selectionState: "selected",
        selectedAt: "2026-08-01T00:30:00.000Z",
        acknowledgedAt: null,
        archivedAt: null,
        sourceCreatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
});

test("genus code validation: exactly 2 uppercase letters", () => {
  assert.equal(validateGenusCode("HY"), null);
  assert.equal(validateGenusCode("AL"), null);
  assert.match(validateGenusCode("hy") ?? "", /2 uppercase letters/);
  assert.match(validateGenusCode("H") ?? "", /2 uppercase letters/);
  assert.match(validateGenusCode("HYX") ?? "", /2 uppercase letters/);
  assert.match(validateGenusCode("H1") ?? "", /2 uppercase letters/);
});

test("plant code validation: exactly 3 uppercase letters/digits, no spaces or punctuation", () => {
  assert.equal(validatePlantCode("KRQ"), null);
  assert.equal(validatePlantCode("AB1"), null);
  assert.match(validatePlantCode("krq") ?? "", /3 uppercase/);
  assert.match(validatePlantCode("AB") ?? "", /3 uppercase/);
  assert.match(validatePlantCode("ABCD") ?? "", /3 uppercase/);
  assert.match(validatePlantCode("A-B") ?? "", /3 uppercase/);
  assert.match(validatePlantCode("A B") ?? "", /3 uppercase/);
});
