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

export type CommercePlantRecord = {
  sourceSystem: "skrybix";
  sourceRecordId: string;
  sku: string;
  displayName: string | null;
  parentSourceRecordId: string;
  plantRecordType: "cutting";
  state: "active" | "sold" | "archived";
  selectionState: "selected" | "acknowledged";
  selectedAt: string;
  acknowledgedAt: string | null;
  archivedAt: string | null;
  sourceCreatedAt: string;
};

export type CommerceSelectionSource = Pick<
  CuttingCommerceSource,
  "cutting_id" | "commerce_selected_at" | "commerce_acknowledged_at"
>;

export type CommerceSelectionRepository = {
  claimUnselected: (
    cuttingId: string,
    selectedAt: string
  ) => Promise<{ record: CommerceSelectionSource | null; error: string | null }>;
  findById: (cuttingId: string) => Promise<{ record: CommerceSelectionSource | null; error: string | null }>;
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

export function getCommerceHandoffState(cutting: CommerceSelectionSource): CommerceHandoffState {
  if (cutting.commerce_acknowledged_at) {
    return "acknowledged";
  }
  if (cutting.commerce_selected_at) {
    return "selected";
  }
  return "unselected";
}

export function getCommercePlantState(cutting: CuttingCommerceSource): "active" | "sold" | "archived" {
  if (cutting.archived_at) {
    return "archived";
  }
  return cutting.sold ? "sold" : "active";
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

export function createCommerceExport(cuttings: CuttingCommerceSource[], retrievedAt: string) {
  return {
    exportVersion: "1.0",
    sourceSystem: "skrybix" as const,
    retrievedAt,
    records: cuttings
      .filter((cutting) => getCommerceHandoffState(cutting) === "selected")
      .map(normalizeCuttingForCommerce),
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
  cuttingId: string,
  selectedAt: string
): Promise<CommerceSelectionResult> {
  const claimed = await repository.claimUnselected(cuttingId, selectedAt);
  if (claimed.error) {
    return { record: null, alreadySelected: false, error: claimed.error };
  }
  if (claimed.record) {
    return { record: claimed.record, alreadySelected: false, error: null };
  }

  const existing = await repository.findById(cuttingId);
  if (existing.error) {
    return { record: null, alreadySelected: false, error: existing.error };
  }
  if (!existing.record) {
    return { record: null, alreadySelected: false, error: "Unknown cutting." };
  }

  return { record: existing.record, alreadySelected: true, error: null };
}
