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
  const { data, error } = await supabase.rpc("skrybix_mark_mother_labels_printed", {
    p_mother_ids: motherIds,
  });
  if (error) throw new Error(`Could not record printed mother labels: ${error.message}`);
  if (data !== motherIds.length) {
    throw new Error(`Recorded ${data} of ${motherIds.length} mother labels. Unrecorded labels remain queued.`);
  }
  revalidatePath("/labels/mothers");
  revalidatePath("/mothers");
}

export async function clearPrintedCuttings(cuttingIds: string[]) {
  if (cuttingIds.length === 0) return;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("skrybix_mark_cutting_labels_printed", {
    p_cutting_ids: cuttingIds,
  });
  if (error) throw new Error(`Could not record printed cutting labels: ${error.message}`);
  if (data !== cuttingIds.length) {
    throw new Error(`Recorded ${data} of ${cuttingIds.length} cutting labels. Unrecorded labels remain queued.`);
  }
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
