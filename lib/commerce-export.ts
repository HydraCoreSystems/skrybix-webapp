export type CuttingCommerceSource = {
  cutting_id: string;
  mother_id: string;
  full_display_name: string | null;
  sold: boolean;
  archived_at: string | null;
  created_at: string;
};

export type CommercePlantRecord = {
  source_system: "skrybix";
  source_record_id: string;
  plant_identity: string;
  plant_record_type: "cutting";
  display_name: string | null;
  parent_source_record_id: string;
  is_active: boolean;
  is_sold: boolean;
  archived_at: string | null;
  source_created_at: string;
};

export function normalizeCuttingForCommerce(cutting: CuttingCommerceSource): CommercePlantRecord {
  return {
    source_system: "skrybix",
    source_record_id: cutting.cutting_id,
    plant_identity: cutting.cutting_id,
    plant_record_type: "cutting",
    display_name: cutting.full_display_name,
    parent_source_record_id: cutting.mother_id,
    is_active: cutting.archived_at === null,
    is_sold: cutting.sold,
    archived_at: cutting.archived_at,
    source_created_at: cutting.created_at,
  };
}
