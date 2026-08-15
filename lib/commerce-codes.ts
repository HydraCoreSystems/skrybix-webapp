import { getSupabaseServerClient } from "@/lib/supabase";
import type { GenusCode, PlantCode } from "@/lib/commerce-sku";

// Fails closed (throws) on a real query error -- a Supabase/config
// failure must not be allowed to quietly render as "no codes exist yet,"
// which would look identical to a genuinely empty registry and could
// prompt an operator to re-create codes that already exist.
export async function getCommerceCodeOptions(): Promise<{ genusCodes: GenusCode[]; plantCodes: PlantCode[] }> {
  const supabase = getSupabaseServerClient();
  const [
    { data: genusCodes, error: genusError },
    { data: plantCodes, error: plantError },
  ] = await Promise.all([
    supabase.from("genus_codes").select("code,genus_name").order("genus_name"),
    supabase.from("plant_codes").select("genus_code,code,display_label").order("code"),
  ]);

  if (genusError) {
    throw new Error(`Unable to load commerce genus codes: ${genusError.message}`);
  }
  if (plantError) {
    throw new Error(`Unable to load commerce plant codes: ${plantError.message}`);
  }

  return {
    genusCodes: (genusCodes ?? []) as GenusCode[],
    plantCodes: (plantCodes ?? []) as PlantCode[],
  };
}
