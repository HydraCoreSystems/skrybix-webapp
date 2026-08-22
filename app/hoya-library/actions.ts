"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function markHoyaSpeciesCollected(speciesId: number) {
  if (!Number.isSafeInteger(speciesId) || speciesId < 1) {
    redirect("/hoya-library?error=That+species+could+not+be+identified.");
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("hoya_species")
    .select("id,in_collection,date_added")
    .eq("id", speciesId)
    .maybeSingle();

  if (error || !data) {
    redirect(`/hoya-library?error=${encodeURIComponent(error?.message ?? "Species not found.")}`);
  }

  if (!data.in_collection) {
    const { error: updateError } = await supabase
      .from("hoya_species")
      .update({
        in_collection: true,
        date_added: data.date_added ?? new Date().toISOString().slice(0, 10),
      })
      .eq("id", speciesId)
      .eq("in_collection", false);

    if (updateError) {
      redirect(`/hoya-library?error=${encodeURIComponent(updateError.message)}`);
    }
  }

  revalidatePath("/hoya-library");
  redirect("/hoya-library?success=Species+added+to+your+collection+history.");
}
