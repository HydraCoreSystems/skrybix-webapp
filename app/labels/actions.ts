"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function clearMotherPrintQueue() {
  const supabase = getSupabaseServerClient();
  await supabase.from("mother_plants").update({ print_label: false }).eq("print_label", true);
  revalidatePath("/labels/mothers");
  revalidatePath("/mothers");
}

export async function clearCuttingPrintQueue() {
  const supabase = getSupabaseServerClient();
  await supabase.from("cuttings").update({ print_label: false }).eq("print_label", true);
  revalidatePath("/labels/cuttings");
  revalidatePath("/cuttings");
}
