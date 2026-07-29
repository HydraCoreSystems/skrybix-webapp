"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { markSpeciesOwnedIfNeeded } from "@/lib/species-tracker";

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
  const motherId = String(formData.get("mother_id") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();

  if (!motherId || !displayName) {
    redirect("/mothers/new?error=" + encodeURIComponent("Mother ID and Display Name are required."));
  }

  const supabase = getSupabaseServerClient();
  const naming = namingFieldsFromForm(formData);
  const { error } = await supabase.from("mother_plants").insert({
    mother_id: motherId,
    display_name: displayName,
    location: nullIfBlank(formData.get("location")),
    ...naming,
  });

  if (error) {
    const message = error.code === "23505" ? `Mother ID "${motherId}" already exists.` : error.message;
    redirect("/mothers/new?error=" + encodeURIComponent(message));
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
