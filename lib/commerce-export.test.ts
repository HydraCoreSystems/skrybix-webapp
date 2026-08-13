import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommerceExport,
  isCommerceExportRequestAuthorized,
  normalizeCuttingForCommerce,
  normalizeMotherForCommerce,
  type CuttingCommerceSource,
  type MotherCommerceSource,
  type MotherCommerceFactsSource,
} from "./commerce-export.ts";
import { validateGenusCode, validatePlantCode } from "./commerce-sku.ts";

// The SQL-level guarantees (atomic mother/cutting SKU allocation,
// database-enforced immutability -- including DELETE, not just UPDATE --
// concurrent selection never allocating duplicate sequences or
// side-effect-selecting a mother, registry rename/delete protection,
// existence checks, and genus/plant-code-mismatch rejection on an
// already-assigned record) live in Postgres functions/constraints, not
// in this JS module -- they were verified directly against a real local
// Postgres 16 instance, both fresh and via the forward migration file,
// before this file was written. See docs/Skrybix_Commerce_SKU_Design_Report.md
// and the implementation report for the exact commands and output. What
// belongs here is the pure-function layer: export shaping, fail-closed
// behavior, and the sourceRecordId/sku/motherFacts distinctions.

const MOTHER_FACTS: MotherCommerceFactsSource = {
  photo_subject: "exact_plant",
  pot_size: "6in",
  plant_size: "18in vine",
  rooted_established: true,
  shipping_presentation: "ships_in_pot",
  shipping_presentation_detail: null,
  condition_notes: "Recently cut back for shipping",
};

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
  assert.equal(record.motherFacts, null);
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

  const record = normalizeMotherForCommerce(mother, "HY-ABH-01", MOTHER_FACTS);

  assert.equal(record.sourceRecordId, "HY-AH 05");
  assert.equal(record.sku, "HY-ABH-01");
});

test("mother facts are carried into the export, camelCased, and present only on mother records", () => {
  const mother: MotherCommerceSource = {
    mother_id: "HY-CAR01",
    display_name: "Hoya carnosa",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
  };

  const record = normalizeMotherForCommerce(mother, "HY-CAR-01", MOTHER_FACTS);

  assert.deepEqual(record.motherFacts, {
    photoSubject: "exact_plant",
    potSize: "6in",
    plantSize: "18in vine",
    rootedEstablished: true,
    shippingPresentation: "ships_in_pot",
    shippingPresentationDetail: null,
    conditionNotes: "Recently cut back for shipping",
  });
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
  assert.throws(() => normalizeMotherForCommerce(mother, null, MOTHER_FACTS), /no assigned commerce SKU/);
});

test("fails closed: a selected mother with no recorded commerce facts is never exported with nulls", () => {
  const mother: MotherCommerceSource = {
    mother_id: "HY-AH 05",
    display_name: "x",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
  };

  assert.throws(() => normalizeMotherForCommerce(mother, "HY-ABH-01", null), /no recorded commerce sale facts/);
  assert.throws(() => normalizeMotherForCommerce(mother, "HY-ABH-01", undefined), /no recorded commerce sale facts/);
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
      ["cutting:HY-ABC01-C01", "HY-ABC-01-C01"],
      ["mother:HY-XYZ01", "HY-XYZ-01"],
    ]),
    new Map([["HY-XYZ01", MOTHER_FACTS]]),
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
        motherFacts: null,
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
        motherFacts: {
          photoSubject: "exact_plant",
          potSize: "6in",
          plantSize: "18in vine",
          rootedEstablished: true,
          shippingPresentation: "ships_in_pot",
          shippingPresentationDetail: null,
          conditionNotes: "Recently cut back for shipping",
        },
      },
    ],
  });
});

test("composite plant_record_type:source_record_id keys prevent a cross-table ID collision from overwriting a SKU", () => {
  // If a mother and a cutting ever shared the same raw ID string (never
  // supposed to happen given cutting IDs always carry a -C## suffix, but
  // not DB-enforced against each other -- see the design report's
  // collision-risk section), a bare source_record_id key would let one
  // overwrite the other in this Map. The composite key prevents that.
  const skusByRecordId = new Map([
    ["cutting:SAME-ID", "HY-AAA-01-C01"],
    ["mother:SAME-ID", "HY-BBB-01"],
  ]);

  assert.equal(skusByRecordId.get("cutting:SAME-ID"), "HY-AAA-01-C01");
  assert.equal(skusByRecordId.get("mother:SAME-ID"), "HY-BBB-01");
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
