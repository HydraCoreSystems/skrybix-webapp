"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { markSpeciesOwnedIfNeeded } from "@/lib/species-tracker";
import { buildMotherId, deriveSpec3 } from "@/lib/mother-id";
import { composeDisplayName } from "@/lib/hoya-naming";
import type { CommerceSelectionActionResult } from "@/lib/commerce-export";
import type { MotherCommerceFactsInput } from "@/lib/commerce-sku";

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
  const naming = namingFieldsFromForm(formData);
  const spec3 = deriveSpec3(naming.species, naming.cultivar);
  if (!spec3) {
    redirect(
      "/mothers/new?error=" +
        encodeURIComponent("Enter either a Species or a Cultivar/Collection Code/Descriptor to assign a Mother ID.")
    );
  }

  const displayName = composeDisplayName(naming.botanical_line1 || "", naming.botanical_line2 || "");

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
  const displayName = composeDisplayName(naming.botanical_line1 || "", naming.botanical_line2 || "");
  const { error } = await supabase
    .from("mother_plants")
    .update({
      display_name: displayName,
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

export async function toggleMotherField(motherId: string, field: "sold" | "print_label", value: boolean) {
  const supabase = getSupabaseServerClient();
  await supabase
    .from("mother_plants")
    .update({ [field]: value })
    .eq("mother_id", motherId);
  revalidatePath("/mothers");
  if (field === "print_label") {
    revalidatePath("/labels/mothers");
  }
}

// OWNER DECISION (existing-ID-as-SKU correction): mother_id IS the
// commerce/Shopify SKU -- no separate genus/plant-code SKU is generated
// anymore. Records the required mother-sale facts (pot size, plant size,
// rooted/established, shipping presentation, photo subject) and marks
// the mother selected, atomically, via the corrected
// select_mother_for_commerce(text, ...) RPC (a new, narrower overload --
// see supabase/schema.sql). Facts are never inferred or defaulted here
// -- every required field must arrive from the form; a missing one fails
// the whole call (enforced again at the database level via NOT NULL,
// not just here). The RPC returns p_mother_id verbatim, so `sku` in the
// result is always exactly the mother's own ID.
export async function selectMotherForCommerce(
  motherId: string,
  facts: MotherCommerceFactsInput
): Promise<CommerceSelectionActionResult> {
  const normalizedMotherId = motherId.trim();

  if (!normalizedMotherId) {
    return { ok: false, message: "A mother ID is required." };
  }
  if (!facts.potSize.trim() || !facts.plantSize.trim()) {
    return { ok: false, message: "Pot size and plant size are required." };
  }
  if (facts.shippingPresentation === "prepared_other" && !facts.shippingPresentationDetail?.trim()) {
    return { ok: false, message: 'Describe how the plant ships when "prepared another way" is selected.' };
  }

  const supabase = getSupabaseServerClient();
  const { data: sku, error } = await supabase.rpc("select_mother_for_commerce", {
    p_mother_id: normalizedMotherId,
    p_photo_subject: facts.photoSubject,
    p_pot_size: facts.potSize.trim(),
    p_plant_size: facts.plantSize.trim(),
    p_rooted_established: facts.rootedEstablished,
    p_shipping_presentation: facts.shippingPresentation,
    p_shipping_presentation_detail: facts.shippingPresentationDetail?.trim() || null,
    p_condition_notes: facts.conditionNotes?.trim() || null,
  });

  if (error || !sku) {
    return { ok: false, message: error?.message ?? "Could not select mother plant for GM Commerce." };
  }

  revalidatePath("/mothers");
  return { ok: true, sku: sku as string };
}
