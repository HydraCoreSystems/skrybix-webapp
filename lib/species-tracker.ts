import { getSupabaseServerClient } from "@/lib/supabase";

// Marks a Hoya_Species row "owned" the first time it's seen on a mother
// plant. Deliberately never un-marks In_Collection later (it's "have I
// ever owned this," not a live inventory count — see CLAUDE.md) and
// never overwrites an existing Date_Added, so the date always reflects
// first acquisition.
export async function markSpeciesOwnedIfNeeded(species: string | null | undefined): Promise<void> {
  const trimmed = species?.trim();
  if (!trimmed) return;

  const supabase = getSupabaseServerClient();
  const { data: match } = await supabase
    .from("hoya_species")
    .select("id, in_collection, date_added")
    .ilike("species", trimmed)
    .maybeSingle();

  if (!match) return;

  const updates: Record<string, unknown> = {};
  if (!match.in_collection) updates.in_collection = true;
  if (!match.date_added) updates.date_added = new Date().toISOString().slice(0, 10);

  if (Object.keys(updates).length) {
    await supabase.from("hoya_species").update(updates).eq("id", match.id);
  }
}
