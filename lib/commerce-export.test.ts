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

// OWNER DECISION (existing-ID-as-SKU correction, superseding the
// short-lived genus/plant-code standardized-SKU design): mother_id/
// cutting_id ARE the commerce/Shopify SKU, byte-for-byte, always. There
// is no separate sku parameter anymore -- normalizeCuttingForCommerce/
// normalizeMotherForCommerce compute sku directly from the source
// record's own ID field. The database-boundary guarantees (atomicity,
// idempotency, dormancy of the old genus/plant-code objects) live in
// Postgres functions/constraints, not JS -- see
// supabase/existing_id_commerce_tests.sql for those, verified against a
// real local Postgres 16 instance. What belongs here is the pure-function
// layer: exact identity preservation and export shaping.

const MOTHER_FACTS: MotherCommerceFactsSource = {
  photo_subject: "exact_plant",
  pot_size: "6in",
  plant_size: "18in vine",
  rooted_established: true,
  shipping_presentation: "ships_in_pot",
  shipping_presentation_detail: null,
  condition_notes: "Recently cut back for shipping",
};

function cutting(overrides: Partial<CuttingCommerceSource>): CuttingCommerceSource {
  return {
    cutting_id: "HY-ICE01-C01",
    mother_id: "HY-ICE01",
    full_display_name: "Hoya iceana",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
    ...overrides,
  };
}

function mother(overrides: Partial<MotherCommerceSource>): MotherCommerceSource {
  return {
    mother_id: "HY-ICE01",
    display_name: "Hoya iceana",
    sold: false,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    commerce_selected_at: "2026-08-13T00:00:00.000Z",
    commerce_acknowledged_at: null,
    ...overrides,
  };
}

test("mother HY-ICE01 exports with sku exactly equal to sourceRecordId", () => {
  const record = normalizeMotherForCommerce(mother({ mother_id: "HY-ICE01" }), MOTHER_FACTS);
  assert.equal(record.sourceRecordId, "HY-ICE01");
  assert.equal(record.sku, "HY-ICE01");
  assert.equal(record.sku, record.sourceRecordId);
});

test("cutting HY-ICE01-C01 exports unchanged, sku === sourceRecordId", () => {
  const record = normalizeCuttingForCommerce(cutting({ cutting_id: "HY-ICE01-C01", mother_id: "HY-ICE01" }));
  assert.equal(record.sourceRecordId, "HY-ICE01-C01");
  assert.equal(record.sku, "HY-ICE01-C01");
});

test("cutting HY-ICE01-C100 exports unchanged -- no truncation past two digits", () => {
  const record = normalizeCuttingForCommerce(cutting({ cutting_id: "HY-ICE01-C100", mother_id: "HY-ICE01" }));
  assert.equal(record.sourceRecordId, "HY-ICE01-C100");
  assert.equal(record.sku, "HY-ICE01-C100");
  assert.ok(record.sku.endsWith("C100"), "must be C100, not truncated to C10 or C00");
});

test("mother HY-AH 01 exports unchanged -- internal space not trimmed, collapsed, or replaced", () => {
  const record = normalizeMotherForCommerce(mother({ mother_id: "HY-AH 01", display_name: "Hoya AH Black Magic" }), MOTHER_FACTS);
  assert.equal(record.sourceRecordId, "HY-AH 01");
  assert.equal(record.sku, "HY-AH 01");
  assert.equal(record.sku.includes(" "), true, "the embedded space must survive exactly");
  assert.equal(record.sku, "HY-AH 01", "not 'HY-AH01', 'HY-AH  01', or any other reformatting");
});

test("cutting HY-AH 01-C08 exports unchanged -- internal space preserved through the cutting suffix too", () => {
  const record = normalizeCuttingForCommerce(cutting({ cutting_id: "HY-AH 01-C08", mother_id: "HY-AH 01" }));
  assert.equal(record.sourceRecordId, "HY-AH 01-C08");
  assert.equal(record.sku, "HY-AH 01-C08");
  assert.equal(record.parentSourceRecordId, "HY-AH 01");
});

test("motherFacts export behavior is unchanged by the correction: populated for mothers, null for cuttings", () => {
  const cuttingRecord = normalizeCuttingForCommerce(cutting({}));
  assert.equal(cuttingRecord.motherFacts, null);

  const motherRecord = normalizeMotherForCommerce(mother({}), MOTHER_FACTS);
  assert.deepEqual(motherRecord.motherFacts, {
    photoSubject: "exact_plant",
    potSize: "6in",
    plantSize: "18in vine",
    rootedEstablished: true,
    shippingPresentation: "ships_in_pot",
    shippingPresentationDetail: null,
    conditionNotes: "Recently cut back for shipping",
  });
});

test("fails closed: a selected mother with no recorded commerce facts is still refused (unchanged requirement)", () => {
  const m = mother({ mother_id: "HY-AH 01" });
  assert.throws(() => normalizeMotherForCommerce(m, null), /no recorded commerce sale facts/);
  assert.throws(() => normalizeMotherForCommerce(m, undefined), /no recorded commerce sale facts/);
});

test("fails closed: an unselected record is refused regardless of the correction", () => {
  const unselectedCutting = cutting({ commerce_selected_at: null });
  assert.throws(() => normalizeCuttingForCommerce(unselectedCutting), /Cannot export unselected cutting/);

  const unselectedMother = mother({ commerce_selected_at: null });
  assert.throws(() => normalizeMotherForCommerce(unselectedMother, MOTHER_FACTS), /Cannot export unselected mother/);
});

test("mixed mother/cutting response: both record types export correctly with sku === sourceRecordId for every record, API shape unchanged", () => {
  const handoff = createCommerceExport(
    [
      cutting({
        cutting_id: "HY-ICE01-C01",
        mother_id: "HY-ICE01",
        full_display_name: "Hoya iceana",
        commerce_selected_at: "2026-08-01T00:00:00.000Z",
      }),
      cutting({
        cutting_id: "HY-ICE01-C02",
        mother_id: "HY-ICE01",
        full_display_name: "Unselected Hoya",
        commerce_selected_at: null,
      }),
      cutting({
        cutting_id: "HY-ICE01-C03",
        mother_id: "HY-ICE01",
        full_display_name: "Acknowledged Hoya",
        sold: true,
        commerce_selected_at: "2026-07-31T00:00:00.000Z",
        commerce_acknowledged_at: "2026-08-01T01:00:00.000Z",
      }),
    ],
    [
      mother({
        mother_id: "HY-XYZ01",
        display_name: "Hoya whole-mother example",
        created_at: "2026-06-01T00:00:00.000Z",
        commerce_selected_at: "2026-08-01T00:30:00.000Z",
      }),
      mother({
        mother_id: "HY-XYZ02",
        display_name: "Unselected mother",
        commerce_selected_at: null,
      }),
    ],
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
        sourceRecordId: "HY-ICE01-C01",
        sku: "HY-ICE01-C01",
        displayName: "Hoya iceana",
        parentSourceRecordId: "HY-ICE01",
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
        sku: "HY-XYZ01",
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

  for (const record of handoff.records) {
    assert.equal(record.sku, record.sourceRecordId, `sku must equal sourceRecordId for ${record.sourceRecordId}`);
  }
});
