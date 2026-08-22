export type HoyaSpeciesRecord = {
  id: number;
  genus: string;
  species: string;
  in_collection: boolean;
  date_added: string | null;
  preferred_id_code: string | null;
  native_range: string | null;
  region_group: string | null;
  growth_habit: string | null;
  leaf_notes: string | null;
  bloom_notes: string | null;
  authority: string | null;
  notes: string | null;
  source: string | null;
  unique_id: string | null;
};

export type CollectionFilter = "all" | "collected" | "not-collected";

export function filterHoyaSpecies(
  records: HoyaSpeciesRecord[],
  query: string,
  collectionFilter: CollectionFilter,
  region: string
): HoyaSpeciesRecord[] {
  const needle = query.trim().toLowerCase();
  return records.filter((record) => {
    if (collectionFilter === "collected" && !record.in_collection) return false;
    if (collectionFilter === "not-collected" && record.in_collection) return false;
    if (region && record.region_group !== region) return false;
    if (!needle) return true;

    return [
      record.genus,
      record.species,
      record.authority,
      record.native_range,
      record.region_group,
      record.growth_habit,
      record.leaf_notes,
      record.bloom_notes,
    ].some((value) => value?.toLowerCase().includes(needle));
  });
}

export function collectionProgress(records: HoyaSpeciesRecord[]) {
  const collected = records.filter((record) => record.in_collection).length;
  const total = records.length;
  return {
    collected,
    total,
    percent: total === 0 ? 0 : Math.round((collected / total) * 100),
  };
}

export function displayBotanicalName(record: Pick<HoyaSpeciesRecord, "genus" | "species">) {
  return `${record.genus} ${record.species}`.trim();
}
