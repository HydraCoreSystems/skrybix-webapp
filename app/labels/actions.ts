"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

// Scoped clear -- called once Phil confirms a specific batch of labels
// actually printed (see components/PrintButton.tsx). Clears ONLY the exact
// rows that were on that print page at the moment he clicked Print, by
// primary key, never a blanket "every currently queued row" update. That
// distinction matters: if something new gets queued for print between his
// Print click and his confirmation, this must not sweep that unrelated row
// up too.
export async function clearPrintedMothers(motherIds: string[]) {
  if (motherIds.length === 0) return;
  const supabase = getSupabaseServerClient();
  await supabase.from("mother_plants").update({ print_label: false }).in("mother_id", motherIds);
  revalidatePath("/labels/mothers");
  revalidatePath("/mothers");
}

export async function clearPrintedCuttings(cuttingIds: string[]) {
  if (cuttingIds.length === 0) return;
  const supabase = getSupabaseServerClient();
  await supabase.from("cuttings").update({ print_label: false }).in("cutting_id", cuttingIds);
  revalidatePath("/labels/cuttings");
  revalidatePath("/cuttings");
}

// Manual bulk override, kept for the case where the queue needs to be
// wiped outright (e.g. recovering from a bad state) rather than confirmed
// print-by-print. Intentionally still blanket-scoped to every currently
// queued row -- that breadth is the point of this one, unlike the
// per-batch actions above.
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
