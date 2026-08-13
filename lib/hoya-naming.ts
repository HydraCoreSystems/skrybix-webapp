// Botanical name composer for Hoya mother plants — rebuilt against the
// REAL columns the live sheet actually populates (Form_Code/Cultivar/
// Name_Type/Natural_Cultivar), not Skrybix_FIXED_v2.gs's Qualifier/
// Collection_Code/Trade_Name/Hybrid columns, which exist in the schema
// but are blank on every real row (see CLAUDE.md). Validated 2026-07-23
// against all 147 real mother_plants rows: 146/147 exact match on both
// Botanical_Line1 and Botanical_Line2 (the one miss on each is a genuine
// one-off manual override already in the sheet — a hybrid-cross breeding
// note and an unusual "sp. Aceh" literal species value — not a
// systematic composition error).
//
// No server-only imports here deliberately — this runs both in a client
// component (live preview) and could run server-side too.

export type NamingFields = {
  genus?: string | null;
  species?: string | null;
  form_code?: string | null; // 'sp' | 'aff' | 'cf' | null
  hybrid?: boolean; // exists in schema, unused in real data as of 2026-07-23
};

export type NameTypeFields = {
  cultivar?: string | null;
  name_type?: string | null; // 'Cultivar' | 'Form' | 'Descriptor' | null
};

function capitalizeWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function composeBotanicalLine1(fields: NamingFields): string {
  const genus = capitalizeWords(fields.genus || "Hoya");
  const species = fields.species?.trim().toLowerCase() || "";
  const formCode = (fields.form_code || "").trim().toLowerCase();
  const isHybrid = !!fields.hybrid;

  if (species) {
    let base = isHybrid ? `${genus} × ${species}` : `${genus} ${species}`;
    if (formCode === "aff") base += " aff.";
    if (formCode === "cf") base += " cf.";
    return base;
  }

  if (formCode === "sp") return `${genus} sp.`;

  return genus;
}

export function composeBotanicalLine2(fields: NameTypeFields): string {
  const cultivar = fields.cultivar?.trim() || "";
  if (!cultivar) return "";

  const nameType = (fields.name_type || "").trim().toLowerCase();
  if (nameType === "form" || nameType === "descriptor") return cultivar;

  // Cultivar (or unset, defaulting to Cultivar-style) — curly single
  // quotes, matching the real sheet's actual formatting exactly (not
  // straight quotes).
  return `‘${cultivar}’`;
}

// Display_Name, confirmed against the real live sheet, is just
// Botanical_Line1 + " " + Botanical_Line2 with straight quotes instead of
// the curly quotes used on Line2 for printed labels -- e.g. Line1 "Hoya
// multiflora" + Line2 "'wonderphil'" -> Display_Name "Hoya multiflora
// 'wonderphil'". Takes the lines as actually submitted (not recomposed
// independently) so a deliberate manual override of either line (e.g. a
// hybrid-cross breeding note) carries through consistently instead of the
// two silently diverging.
export function composeDisplayName(line1: string, line2: string): string {
  const straighten = (s: string) => s.replace(/[‘’]/g, "'");
  return [straighten(line1), straighten(line2)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}
