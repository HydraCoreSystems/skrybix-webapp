"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { validateGenusCode, validatePlantCode } from "@/lib/commerce-sku";

export type CreatePlantCodeResult = { ok: true } | { ok: false; message: string };

// Deliberately no auto-generation -- a plant code is only ever created
// by a human explicitly typing one in, here or in the selection form
// itself. Collisions are caught by plant_codes' own (genus_code, code)
// unique constraint (supabase/schema.sql) and surfaced as a plain error,
// not silently resolved.
export async function createPlantCode(genusCode: string, code: string, displayLabel: string): Promise<CreatePlantCodeResult> {
  const normalizedGenus = genusCode.trim().toUpperCase();
  const normalizedCode = code.trim().toUpperCase();
  const normalizedLabel = displayLabel.trim();

  const genusError = validateGenusCode(normalizedGenus);
  if (genusError) return { ok: false, message: genusError };
  const codeError = validatePlantCode(normalizedCode);
  if (codeError) return { ok: false, message: codeError };
  if (!normalizedLabel) {
    return { ok: false, message: "A short description of what this code identifies is required." };
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("plant_codes").insert({
    genus_code: normalizedGenus,
    code: normalizedCode,
    display_label: normalizedLabel,
  });

  if (error) {
    const message =
      error.code === "23505"
        ? `Code "${normalizedGenus}-${normalizedCode}" is already assigned to another plant identity.`
        : error.message;
    return { ok: false, message };
  }

  revalidatePath("/mothers");
  revalidatePath("/cuttings");
  return { ok: true };
}
