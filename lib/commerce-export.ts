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
};

// Selection/acknowledgement bookkeeping only -- deliberately has no id
// field. The concrete id column differs by source table (cutting_id vs
// mother_id) and nothing in the generic selection flow below ever needs
// to read it back off the record, so dropping it lets both cuttings and
// mothers share this type and selectCommerceRecord() as-is.
export type CommerceSelectionSource = {
  commerce_selected_at: string | null;
  commerce_acknowledged_at: string | null;
};

export type CommerceSelectionRepository = {
  claimUnselected: (
    id: string,
    selectedAt: string
  ) => Promise<{ record: CommerceSelectionSource | null; error: string | null }>;
  findById: (id: string) => Promise<{ record: CommerceSelectionSource | null; error: string | null }>;
};

export type CommerceSelectionResult =
  | {
      record: CommerceSelectionSource;
      alreadySelected: boolean;
      error: null;
    }
  | {
      record: null;
      alreadySelected: false;
      error: string;
    };

// Return shape for the two Server Actions (selectCuttingForCommerce,
// selectMotherForCommerce) that wrap selectCommerceRecord() below for a
// specific table -- shared here so both actions files and
// CommerceSelectionControl.tsx agree on one type.
export type CommerceSelectionActionResult =
  | { ok: true; state: "selected" | "acknowledged"; alreadySelected: boolean }
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
  };
}

export function normalizeMotherForCommerce(mother: MotherCommerceSource): CommercePlantRecord {
  const selectionState = getCommerceHandoffState(mother);
  if (selectionState === "unselected" || !mother.commerce_selected_at) {
    throw new Error(`Cannot export unselected mother plant ${mother.mother_id}.`);
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
  };
}

export function createCommerceExport(
  cuttings: CuttingCommerceSource[],
  mothers: MotherCommerceSource[],
  retrievedAt: string
) {
  return {
    exportVersion: "1.0",
    sourceSystem: "skrybix" as const,
    retrievedAt,
    records: [
      ...cuttings.filter((cutting) => getCommerceHandoffState(cutting) === "selected").map(normalizeCuttingForCommerce),
      ...mothers.filter((mother) => getCommerceHandoffState(mother) === "selected").map(normalizeMotherForCommerce),
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

export async function selectCommerceRecord(
  repository: CommerceSelectionRepository,
  id: string,
  selectedAt: string
): Promise<CommerceSelectionResult> {
  const claimed = await repository.claimUnselected(id, selectedAt);
  if (claimed.error) {
    return { record: null, alreadySelected: false, error: claimed.error };
  }
  if (claimed.record) {
    return { record: claimed.record, alreadySelected: false, error: null };
  }

  const existing = await repository.findById(id);
  if (existing.error) {
    return { record: null, alreadySelected: false, error: existing.error };
  }
  if (!existing.record) {
    return { record: null, alreadySelected: false, error: "Unknown record." };
  }

  return { record: existing.record, alreadySelected: true, error: null };
}
