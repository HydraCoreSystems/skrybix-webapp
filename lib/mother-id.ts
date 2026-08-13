// Mother_ID auto-assignment, ported from the live production spreadsheet's
// actual behavior (confirmed against real Mother_Plants rows, not the
// reference/Skrybix_FIXED_v2.gs script -- that script only auto-assigns
// IDs for species matched in Hoya_Species, which doesn't cover the many
// real unidentified/cultivar mothers). Do not "fix" the trailing-space
// case below -- it's real and present in real IDs (e.g. "HY-AH 01").

// The first 3 characters (uppercased, not trimmed) of whichever field is
// this mother's identifying name: the species epithet if one is recorded,
// otherwise the cultivar/collection-descriptor text. Returns null if
// neither is present -- the caller must require at least one.
export function deriveSpec3(species: string | null | undefined, cultivar: string | null | undefined): string | null {
  const source = (species && species.trim()) || (cultivar && cultivar.trim()) || null;
  if (!source) return null;
  return source.slice(0, 3).toUpperCase();
}

export function buildMotherId(spec3: string, seq: number): string {
  return `HY-${spec3}${String(seq).padStart(2, "0")}`;
}
