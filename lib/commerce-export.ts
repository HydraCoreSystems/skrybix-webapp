import { timingSafeEqual } from "node:crypto";

export type CommerceHandoffState = "unselected" | "selected" | "acknowledged";

export type CuttingCommerceSource = {
  cutting_id: string;
  mother_id: string;
  full_display_name: string | null;
  sold: boolean;
  archived_at: string | null;
  created_at: string;
  commerce_selected_at: string | null;
  commerce_acknowledged_at: string | null;
};

// Mirrors CuttingCommerceSource for mother plants -- added 2026-08-13 so
// a whole mother plant (not just its cuttings) can be listed for sale
// through the same GM Commerce handoff. mother_plants has no
// archived_at column (unlike cuttings) -- there's no archive concept
// for a mother plant in this schema, only real deletion -- so
// archived_at is always null for a mother record, not read from the DB.
export type MotherCommerceSource = {
  mother_id: string;
  display_name: string | null;
  sold: boolean;
  archived_at: null;
  created_at: string;
  commerce_selected_at: string | null;
  commerce_acknowledged_at: string | null;
};

export const CUTTING_COMMERCE_COLUMNS =
  "cutting_id,mother_id,full_display_name,sold,archived_at,created_at,commerce_selected_at,commerce_acknowledged_at";
export const MOTHER_COMMERCE_COLUMNS =
  "mother_id,display_name,sold,created_at,commerce_selected_at,commerce_acknowledged_at";

// Camel-cased mirror of mother_commerce_facts (supabase/schema.sql) --
// present (never null) on every exported mother record, always null on
// cutting records. Required so GM Commerce can produce the
// intentionally different established-mother sale copy, instead of only
// ever seeing the same cutting-shaped fields.
export type MotherCommerceFacts = {
  photoSubject: "exact_plant" | "representative_plant";
  potSize: string;
  plantSize: string;
  rootedEstablished: boolean;
  shippingPresentation: "ships_in_pot" | "prepared_other";
  shippingPresentationDetail: string | null;
  conditionNotes: string | null;
};

export type MotherCommerceFactsSource = {
  photo_subject: "exact_plant" | "representative_plant";
  pot_size: string;
  plant_size: string;
  rooted_established: boolean;
  shipping_presentation: "ships_in_pot" | "prepared_other";
  shipping_presentation_detail: string | null;
  condition_notes: string | null;
};

export const MOTHER_COMMERCE_FACTS_COLUMNS =
  "source_record_id,photo_subject,pot_size,plant_size,rooted_established,shipping_presentation,shipping_presentation_detail,condition_notes";

function toMotherCommerceFacts(source: MotherCommerceFactsSource): MotherCommerceFacts {
  return {
    photoSubject: source.photo_subject,
    potSize: source.pot_size,
    plantSize: source.plant_size,
    rootedEstablished: source.rooted_established,
    shippingPresentation: source.shipping_presentation,
    shippingPresentationDetail: source.shipping_presentation_detail,
    conditionNotes: source.condition_notes,
  };
}

export type CommercePlantRecord = {
  sourceSystem: "skrybix";
  sourceRecordId: string;
  sku: string;
  displayName: string | null;
  // null for a mother plant record -- it has no parent in Skrybix's own
  // hierarchy, unlike a cutting (parent = the mother it came from).
  parentSourceRecordId: string | null;
  plantRecordType: "cutting" | "mother";
  state: "active" | "sold" | "archived";
  selectionState: "selected" | "acknowledged";
  selectedAt: string;
  acknowledgedAt: string | null;
  archivedAt: string | null;
  sourceCreatedAt: string;
  // Always null for a cutting. Always a real object for a mother -- see
  // normalizeMotherForCommerce, which fails closed (throws) rather than
  // exporting a selected mother with no recorded facts.
  motherFacts: MotherCommerceFacts | null;
};

// Selection/acknowledgement bookkeeping only -- deliberately has no id
// field. The concrete id column differs by source table (cutting_id vs
// mother_id), and this is only used for reading current state (has this
// been selected/acknowledged yet), not for driving the actual selection
// action anymore -- that now goes through the atomic
// select_mother_for_commerce()/select_cutting_for_commerce() Postgres
// functions (supabase/schema.sql), not a JS-orchestrated claim.
export type CommerceSelectionSource = {
  commerce_selected_at: string | null;
  commerce_acknowledged_at: string | null;
};

// Return shape for the Server Actions that wrap the select_*_for_commerce
// RPCs -- shared here so both actions files and the selection form
// component agree on one type.
export type CommerceSelectionActionResult =
  | { ok: true; sku: string }
  | { ok: false; message: string };

export function getCommerceHandoffState(record: CommerceSelectionSource): CommerceHandoffState {
  if (record.commerce_acknowledged_at) {
    return "acknowledged";
  }
  if (record.commerce_selected_at) {
    return "selected";
  }
  return "unselected";
}

export function getCommercePlantState(record: {
  archived_at: string | null;
  sold: boolean;
}): "active" | "sold" | "archived" {
  if (record.archived_at) {
    return "archived";
  }
  return record.sold ? "sold" : "active";
}

// OWNER DECISION (existing-ID-as-SKU correction): the existing
// cutting_id IS the commerce SKU, byte-for-byte, always -- never looked
// up, generated, or derived from a separate table. This is a deliberate
// reversal of the short-lived genus/plant-code standardized-SKU design
// (supabase/schema.sql's now-dormant commerce_skus/genus_codes/
// plant_codes/commerce_*_seq_counters) -- see the correction record in
// CLAUDE.md and docs/Skrybix_Commerce_SKU_Design_Report.md for why.
// Preserves embedded spaces/punctuation exactly (e.g. "HY-AH 01-C08")
// since sku is computed directly from the source field, never
// re-parsed or reformatted.
export function normalizeCuttingForCommerce(cutting: CuttingCommerceSource): CommercePlantRecord {
  const selectionState = getCommerceHandoffState(cutting);
  if (selectionState === "unselected" || !cutting.commerce_selected_at) {
    throw new Error(`Cannot export unselected cutting ${cutting.cutting_id}.`);
  }

  return {
    sourceSystem: "skrybix",
    sourceRecordId: cutting.cutting_id,
    sku: cutting.cutting_id,
    displayName: cutting.full_display_name,
    parentSourceRecordId: cutting.mother_id,
    plantRecordType: "cutting",
    state: getCommercePlantState(cutting),
    selectionState,
    selectedAt: cutting.commerce_selected_at,
    acknowledgedAt: cutting.commerce_acknowledged_at,
    archivedAt: cutting.archived_at,
    sourceCreatedAt: cutting.created_at,
    motherFacts: null,
  };
}

// `facts` is looked up from mother_commerce_facts, keyed by mother_id --
// a selected mother with no recorded facts is refused, not exported
// with nulls. This requirement is unchanged by the existing-ID-as-SKU
// correction: mother_commerce_facts stays required and active, only the
// SKU-generation side (genus/plant codes) was removed.
export function normalizeMotherForCommerce(
  mother: MotherCommerceSource,
  facts: MotherCommerceFactsSource | null | undefined
): CommercePlantRecord {
  const selectionState = getCommerceHandoffState(mother);
  if (selectionState === "unselected" || !mother.commerce_selected_at) {
    throw new Error(`Cannot export unselected mother plant ${mother.mother_id}.`);
  }
  if (!facts) {
    throw new Error(
      `Selected mother ${mother.mother_id} has no recorded commerce sale facts -- refusing to export ` +
        `rather than send GM Commerce a record it cannot render correctly.`
    );
  }

  return {
    sourceSystem: "skrybix",
    sourceRecordId: mother.mother_id,
    sku: mother.mother_id,
    displayName: mother.display_name,
    parentSourceRecordId: null,
    plantRecordType: "mother",
    state: getCommercePlantState(mother),
    selectionState,
    selectedAt: mother.commerce_selected_at,
    acknowledgedAt: mother.commerce_acknowledged_at,
    archivedAt: mother.archived_at,
    sourceCreatedAt: mother.created_at,
    motherFacts: toMotherCommerceFacts(facts),
  };
}

export function createCommerceExport(
  cuttings: CuttingCommerceSource[],
  mothers: MotherCommerceSource[],
  motherFactsByRecordId: Map<string, MotherCommerceFactsSource>,
  retrievedAt: string
) {
  return {
    exportVersion: "1.0",
    sourceSystem: "skrybix" as const,
    retrievedAt,
    records: [
      ...cuttings
        .filter((cutting) => getCommerceHandoffState(cutting) === "selected")
        .map((cutting) => normalizeCuttingForCommerce(cutting)),
      ...mothers
        .filter((mother) => getCommerceHandoffState(mother) === "selected")
        .map((mother) => normalizeMotherForCommerce(mother, motherFactsByRecordId.get(mother.mother_id))),
    ],
  };
}

export function isCommerceExportRequestAuthorized(
  authorizationHeader: string | null,
  configuredToken: string | undefined
): boolean {
  if (!configuredToken || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expectedToken = Buffer.from(configuredToken);
  return (
    suppliedToken.length === expectedToken.length && timingSafeEqual(suppliedToken, expectedToken)
  );
}
