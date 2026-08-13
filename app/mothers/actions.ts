"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { markSpeciesOwnedIfNeeded } from "@/lib/species-tracker";
import { buildMotherId, deriveSpec3 } from "@/lib/mother-id";

function nullIfBlank(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function namingFieldsFromForm(formData: FormData) {
  return {
    genus: nullIfBlank(formData.get("genus")) || "Hoya",
    species: nullIfBlank(formData.get("species")),
    form_code: nullIfBlank(formData.get("form_code")),
    cultivar: nullIfBlank(formData.get("cultivar")),
    name_type: nullIfBlank(formData.get("name_type")),
    natural_cultivar: formData.get("natural_cultivar") === "true",
    botanical_line1: nullIfBlank(formData.get("botanical_line1")),
    botanical_line2: nullIfBlank(formData.get("botanical_line2")),
  };
}

export async function createMother(formData: FormData) {
  const displayName = String(formData.get("display_name") || "").trim();

  if (!displayName) {
    redirect("/mothers/new?error=" + encodeURIComponent("Display Name is required."));
  }

  const naming = namingFieldsFromForm(formData);
  const spec3 = deriveSpec3(naming.species, naming.cultivar);
  if (!spec3) {
    redirect(
      "/mothers/new?error=" +
        encodeURIComponent("Enter either a Species or a Cultivar/Collection Code/Descriptor to assign a Mother ID.")
    );
  }

  const supabase = getSupabaseServerClient();

  // Reserves the next sequence number for this spec3 code atomically (see
  // next_mother_seq() in supabase/schema.sql) -- never scan mother_plants
  // for a max value, same rule as cutting IDs.
  const { data: seq, error: seqError } = await supabase.rpc("next_mother_seq", { p_spec3: spec3 });
  if (seqError || typeof seq !== "number") {
    redirect("/mothers/new?error=" + encodeURIComponent(seqError?.message || "Could not assign a Mother ID."));
  }

  const motherId = buildMotherId(spec3 as string, seq as number);

  const { error } = await supabase.from("mother_plants").insert({
    mother_id: motherId,
    display_name: displayName,
    location: nullIfBlank(formData.get("location")),
    spec3,
    mother_seq: String(seq).padStart(2, "0"),
    ...naming,
  });

  if (error) {
    redirect("/mothers/new?error=" + encodeURIComponent(error.message));
  }

  await markSpeciesOwnedIfNeeded(naming.species);

  revalidatePath("/mothers");
  redirect("/mothers?success=" + encodeURIComponent(`Mother plant "${motherId}" added.`));
}

export async function updateMother(motherId: string, formData: FormData) {
  const supabase = getSupabaseServerClient();
  const naming = namingFieldsFromForm(formData);
  const { error } = await supabase
    .from("mother_plants")
    .update({
      display_name: String(formData.get("display_name") || "").trim(),
      location: nullIfBlank(formData.get("location")),
      ...naming,
    })
    .eq("mother_id", motherId);

  if (error) {
    redirect(`/mothers/${encodeURIComponent(motherId)}/edit?error=${encodeURIComponent(error.message)}`);
  }

  await markSpeciesOwnedIfNeeded(naming.species);

  revalidatePath("/mothers");
  redirect("/mothers?success=" + encodeURIComponent(`Mother plant "${motherId}" updated.`));
}

export async function toggleMotherPrint(motherId: string, value: boolean) {
  const supabase = getSupabaseServerClient();
  await supabase.from("mother_plants").update({ print_label: value }).eq("mother_id", motherId);
  revalidatePath("/mothers");
  revalidatePath("/labels/mothers");
}
