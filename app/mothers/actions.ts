"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function createMother(formData: FormData) {
  const motherId = String(formData.get("mother_id") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();

  if (!motherId || !displayName) {
    redirect("/mothers/new?error=" + encodeURIComponent("Mother ID and Display Name are required."));
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("mother_plants").insert({
    mother_id: motherId,
    display_name: displayName,
    location: String(formData.get("location") || "").trim() || null,
    botanical_line1: String(formData.get("botanical_line1") || "").trim() || null,
    botanical_line2: String(formData.get("botanical_line2") || "").trim() || null,
  });

  if (error) {
    const message = error.code === "23505" ? `Mother ID "${motherId}" already exists.` : error.message;
    redirect("/mothers/new?error=" + encodeURIComponent(message));
  }

  revalidatePath("/mothers");
  redirect("/mothers?success=" + encodeURIComponent(`Mother plant "${motherId}" added.`));
}

export async function updateMother(motherId: string, formData: FormData) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("mother_plants")
    .update({
      display_name: String(formData.get("display_name") || "").trim(),
      location: String(formData.get("location") || "").trim() || null,
      botanical_line1: String(formData.get("botanical_line1") || "").trim() || null,
      botanical_line2: String(formData.get("botanical_line2") || "").trim() || null,
    })
    .eq("mother_id", motherId);

  if (error) {
    redirect(`/mothers/${encodeURIComponent(motherId)}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/mothers");
  redirect("/mothers?success=" + encodeURIComponent(`Mother plant "${motherId}" updated.`));
}

export async function toggleMotherPrint(motherId: string, value: boolean) {
  const supabase = getSupabaseServerClient();
  await supabase.from("mother_plants").update({ print_label: value }).eq("mother_id", motherId);
  revalidatePath("/mothers");
}
