"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CommerceSelectionActionResult } from "@/lib/commerce-export";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function createCuttings(formData: FormData) {
  const motherId = String(formData.get("mother_id") || "").trim();
  const numCuts = Number(formData.get("num_cuts") || 0);
  const dateTaken = String(formData.get("date_taken") || "").trim() || new Date().toISOString().slice(0, 10);

  if (!motherId || numCuts < 1) {
    redirect("/cuttings/new?error=" + encodeURIComponent("Pick a mother plant and at least 1 cutting."));
  }

  const supabase = getSupabaseServerClient();

  const { data: mother, error: motherErr } = await supabase
    .from("mother_plants")
    .select("mother_id, display_name, botanical_line1, botanical_line2")
    .eq("mother_id", motherId)
    .maybeSingle();

  if (motherErr || !mother) {
    redirect("/cuttings/new?error=" + encodeURIComponent("Unknown mother plant."));
  }

  // Persistent, never-reused per-mother counter (see next_cutting_seq() in
  // supabase/schema.sql) — never regenerate IDs by scanning existing rows.
  const { data: seqStart, error: seqErr } = await supabase.rpc("next_cutting_seq", {
    p_mother_id: motherId,
    p_count: numCuts,
  });

  if (seqErr || seqStart === null || seqStart === undefined) {
    redirect(
      "/cuttings/new?error=" +
        encodeURIComponent("Could not generate cutting IDs: " + (seqErr?.message ?? "unknown error"))
    );
  }

  const start = seqStart as number;
  const rows = Array.from({ length: numCuts }, (_, n) => {
    const seq = start + n;
    return {
      cutting_id: `${motherId}-C${String(seq).padStart(2, "0")}`,
      mother_id: motherId,
      full_display_name: mother.display_name,
      label_line1: mother.botanical_line1,
      label_line2: mother.botanical_line2,
      date_taken: dateTaken,
    };
  });

  const { error: insertErr } = await supabase.from("cuttings").insert(rows);
  if (insertErr) {
    redirect("/cuttings/new?error=" + encodeURIComponent(insertErr.message));
  }

  revalidatePath("/cuttings");
  revalidatePath("/");
  redirect(
    "/cuttings?success=" +
      encodeURIComponent(`Created ${rows.length} cutting(s): ${rows.map((r) => r.cutting_id).join(", ")}`)
  );
}

export async function toggleCuttingField(cuttingId: string, field: "sold" | "print_label", value: boolean) {
  const supabase = getSupabaseServerClient();
  await supabase
    .from("cuttings")
    .update({ [field]: value })
    .eq("cutting_id", cuttingId);
  revalidatePath("/cuttings");
  if (field === "print_label") {
    revalidatePath("/labels/cuttings");
  }
}

// OWNER DECISION (existing-ID-as-SKU correction): cutting_id IS the
// commerce/Shopify SKU -- no genus/plant-code SKU is generated. Selecting
// a cutting for GM Commerce requires only an explicit confirmation of
// the cutting itself, via the corrected select_cutting_for_commerce(text)
// RPC (a new, narrower overload -- see supabase/schema.sql). That RPC
// verifies the cutting exists, marks only that cutting's
// commerce_selected_at, never touches its mother, and returns
// p_cutting_id verbatim -- so `sku` in the result is always exactly the
// cutting's own ID.
export async function selectCuttingForCommerce(cuttingId: string): Promise<CommerceSelectionActionResult> {
  const normalizedCuttingId = cuttingId.trim();

  if (!normalizedCuttingId) {
    return { ok: false, message: "A cutting is required." };
  }

  const supabase = getSupabaseServerClient();
  const { data: sku, error } = await supabase.rpc("select_cutting_for_commerce", {
    p_cutting_id: normalizedCuttingId,
  });

  if (error || !sku) {
    return { ok: false, message: error?.message ?? "Could not select cutting for GM Commerce." };
  }

  revalidatePath("/cuttings");
  revalidatePath("/mothers");
  return { ok: true, sku: sku as string };
}

export async function pushSoldToOutgoingLog() {
  const supabase = getSupabaseServerClient();

  const { data: soldRows, error } = await supabase
    .from("cuttings")
    .select("cutting_id, full_display_name")
    .eq("sold", true)
    .is("archived_at", null);

  if (error) {
    redirect("/cuttings?error=" + encodeURIComponent(error.message));
  }

  const rows = soldRows ?? [];
  if (!rows.length) {
    redirect("/cuttings?error=" + encodeURIComponent("No sold cuttings to push."));
  }

  const { data: existing } = await supabase
    .from("outgoing_log")
    .select("cutting_id")
    .in(
      "cutting_id",
      rows.map((r) => r.cutting_id)
    );

  const existingIds = new Set((existing ?? []).map((r) => r.cutting_id));
  const toInsert = rows
    .filter((r) => !existingIds.has(r.cutting_id))
    .map((r) => ({
      cutting_id: r.cutting_id,
      full_display_name: r.full_display_name,
      qty: 1,
      reason: "Sale",
    }));

  if (toInsert.length) {
    const { error: insertErr } = await supabase.from("outgoing_log").insert(toInsert);
    if (insertErr) {
      redirect("/cuttings?error=" + encodeURIComponent(insertErr.message));
    }
  }

  // Archive every pushed row (soft-archive column, see supabase/schema.sql)
  // so active inventory stops counting it — the exact fix
  // Skrybix_FIXED_v2.gs applied on the Sheets side via Archive_Cuttings.
  await supabase
    .from("cuttings")
    .update({ archived_at: new Date().toISOString() })
    .in(
      "cutting_id",
      rows.map((r) => r.cutting_id)
    );

  revalidatePath("/cuttings");
  revalidatePath("/outgoing");
  revalidatePath("/");
  redirect(
    "/cuttings?success=" +
      encodeURIComponent(`Pushed ${toInsert.length} sold cutting(s) to Outgoing Log, archived ${rows.length}.`)
  );
}
