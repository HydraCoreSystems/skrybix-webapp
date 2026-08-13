import { getSupabaseServerClient } from "@/lib/supabase";
import type { GenusCode, PlantCode } from "@/lib/commerce-sku";

export async function getCommerceCodeOptions(): Promise<{ genusCodes: GenusCode[]; plantCodes: PlantCode[] }> {
  const supabase = getSupabaseServerClient();
  const [{ data: genusCodes }, { data: plantCodes }] = await Promise.all([
    supabase.from("genus_codes").select("code,genus_name").order("genus_name"),
    supabase.from("plant_codes").select("genus_code,code,display_label").order("code"),
  ]);

  return {
    genusCodes: (genusCodes ?? []) as GenusCode[],
    plantCodes: (plantCodes ?? []) as PlantCode[],
  };
}
