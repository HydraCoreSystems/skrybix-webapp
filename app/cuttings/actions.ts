"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CommerceSelectionActionResult } from "@/lib/commerce-export";
import {
  computeCommerceBatch,
  computePrintQueueBatch,
  commerceBatchMessage,
  printBatchMessage,
  OUTGOING_REASONS,
  NON_SALE_OUTGOING_REASONS,
  type CuttingBatchRow,
  type OutgoingReason,
  type NonSaleOutgoingReason,
} from "@/lib/cuttings-batch";
import { getSupabaseServerClient } from "@/lib/supabase";

export type BatchActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function createCuttings(formData: FormData) {
  const motherId = String(formData.get("mother_id") || "").trim();
  const numCuts = Number(formData.get("num_cuts") || 0);
  const dateTaken = String(formData.get("date_taken") || "").trim() || new Date().toISOString().slice(0, 10);
  const queueLabels = formData.get("queue_labels") === "yes";

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
      print_label: queueLabels,
    };
  });

  const { error: insertErr } = await supabase.from("cuttings").insert(rows);
  if (insertErr) {
    redirect("/cuttings/new?error=" + encodeURIComponent(insertErr.message));
  }

  revalidatePath("/cuttings");
  revalidatePath("/");
  redirect(
    "/cuttings?batch=" + encodeURIComponent(rows.map((r) => r.cutting_id).join(",")) +
      "&success=" + encodeURIComponent(
        `Created ${rows.length} cutting${rows.length === 1 ? "" : "s"}.` +
        (queueLabels ? " Labels are queued for printing." : " Labels were not queued.")
      )
  );
}

export async function toggleCuttingField(cuttingId: string, field: "sold" | "print_label", value: boolean) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("cuttings")
    .update({ [field]: value })
    .eq("cutting_id", cuttingId);
  // A swallowed error here previously meant a "Mark sold" / "Queue for
  // print" click could silently no-op -- the button would look clicked but
  // the database would be unchanged. Throw so the caller (a <form action>
  // submit or CuttingsBatchTable's client-side call) sees a real failure.
  if (error) {
    throw new Error(`Could not update ${cuttingId}: ${error.message}`);
  }
  revalidatePath("/cuttings");
  revalidatePath(`/cuttings/${encodeURIComponent(cuttingId)}`);
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
  revalidatePath(`/cuttings/${encodeURIComponent(normalizedCuttingId)}`);
  return { ok: true, sku: sku as string };
}

function dedupeIds(cuttingIds: string[]): string[] {
  return Array.from(new Set(cuttingIds.map((s) => s.trim()).filter(Boolean)));
}

// Batch "queue for print": sets print_label = true for every selected cutting
// in one idempotent update. The queue is a boolean flag, so a retry can never
// create a duplicate queue entry — already-queued ids are detected and
// reported as skipped. Returns a plain-language result (not a redirect) so the
// client can clear its selections and show the outcome inline.
export async function queueCuttingsForPrint(cuttingIds: string[]): Promise<BatchActionResult> {
  const ids = dedupeIds(cuttingIds);
  if (ids.length === 0) {
    return { ok: false, message: "Nothing selected to queue." };
  }

  const supabase = getSupabaseServerClient();
  const { data: rowsRaw, error } = await supabase
    .from("cuttings")
    .select("cutting_id, print_label, label_print_count, commerce_selected_at, commerce_acknowledged_at")
    .in("cutting_id", ids)
    .is("archived_at", null);
  if (error) {
    return { ok: false, message: `Could not queue labels: ${error.message}` };
  }

  const rows = (rowsRaw ?? []) as CuttingBatchRow[];
  const plan = computePrintQueueBatch(ids, rows);

  if (plan.toQueue.length > 0) {
    const { error: updateErr } = await supabase
      .from("cuttings")
      .update({ print_label: true })
      .in("cutting_id", plan.toQueue);
    if (updateErr) {
      return { ok: false, message: `Could not queue labels: ${updateErr.message}` };
    }
  }

  revalidatePath("/cuttings");
  revalidatePath("/labels/cuttings");
  ids.forEach((id) => revalidatePath(`/cuttings/${encodeURIComponent(id)}`));
  return { ok: true, message: printBatchMessage(plan) };
}

// Batch "send to GM Commerce": marks every selected cutting selected for GM
// Commerce. select_cutting_for_commerce is idempotent (only sets
// commerce_selected_at when null), so retries are safe and already-selected
// ids are reported as skipped.
export async function sendCuttingsToCommerce(cuttingIds: string[]): Promise<BatchActionResult> {
  const ids = dedupeIds(cuttingIds);
  if (ids.length === 0) {
    return { ok: false, message: "Nothing selected to send." };
  }

  const supabase = getSupabaseServerClient();
  const { data: rowsRaw, error } = await supabase
    .from("cuttings")
    .select("cutting_id, print_label, label_print_count, commerce_selected_at, commerce_acknowledged_at")
    .in("cutting_id", ids)
    .is("archived_at", null);
  if (error) {
    return { ok: false, message: `Could not send cuttings: ${error.message}` };
  }

  const rows = (rowsRaw ?? []) as CuttingBatchRow[];
  const plan = computeCommerceBatch(ids, rows);

  for (const id of plan.toSelect) {
    const { error: rpcErr } = await supabase.rpc("select_cutting_for_commerce", { p_cutting_id: id });
    if (rpcErr) {
      return { ok: false, message: `Could not send ${id} to GM Commerce: ${rpcErr.message}` };
    }
  }

  revalidatePath("/cuttings");
  revalidatePath("/mothers");
  ids.forEach((id) => revalidatePath(`/cuttings/${encodeURIComponent(id)}`));
  return { ok: true, message: commerceBatchMessage(plan) };
}

// Reliability Phase 1: this used to be two separate, unchecked round trips
// (insert into outgoing_log, then a separate archive update with no error
// check at all) -- if the archive update failed or the process died in
// between, a cutting ended up logged as gone while still counting as
// active inventory. Both writes now happen inside one atomic Postgres
// function (skrybix_push_cuttings_to_outgoing, supabase/schema.sql) so a
// cutting can never be added to the outgoing log without being archived,
// or archived without its outgoing record. Same "Sale" reason and qty as
// before. Retained as a compatibility action for older callers; the Phase 2
// workbench no longer exposes a global "push every sold row" button.
export async function pushSoldToOutgoingLog() {
  const supabase = getSupabaseServerClient();

  const { data: soldRows, error } = await supabase
    .from("cuttings")
    .select("cutting_id")
    .eq("sold", true)
    .is("archived_at", null);

  if (error) {
    redirect("/cuttings?error=" + encodeURIComponent(error.message));
  }

  const rows = soldRows ?? [];
  if (!rows.length) {
    redirect("/cuttings?error=" + encodeURIComponent("No sold cuttings to push."));
  }

  const { data: pushedCount, error: pushErr } = await supabase.rpc("skrybix_push_cuttings_to_outgoing", {
    p_cutting_ids: rows.map((r) => r.cutting_id),
    p_reason: "Sale",
  });

  if (pushErr) {
    redirect("/cuttings?error=" + encodeURIComponent(`Could not push sold cuttings: ${pushErr.message}`));
  }

  revalidatePath("/cuttings");
  revalidatePath("/outgoing");
  revalidatePath("/");
  redirect(
    "/cuttings?success=" +
      encodeURIComponent(`Pushed ${pushedCount ?? 0} sold cutting(s) to Outgoing Log and archived them.`)
  );
}

// Non-sale outgoing reasons -- Skrybix's own authoritative-inventory job
// (see CLAUDE.md / docs/CURRENT_ARCHITECTURE.md) requires a way to record
// a cutting leaving inventory for a reason other than a GM Commerce sale.
// Before this, the ONLY code path that ever inserted into outgoing_log was
// pushSoldToOutgoingLog, which required sold = true and hardcoded
// reason = "Sale" -- there was no way, short of a hand-written SQL
// statement, to log a cutting given away, lost, disposed of, traded, or
// kept personally. This is deliberately NOT a sales ledger: no price,
// customer, or channel field is added -- only the same reason/notes
// columns outgoing_log already had. NON_SALE_OUTGOING_REASONS/
// NonSaleOutgoingReason live in lib/cuttings-batch.ts, not here -- a
// "use server" file may only export async functions, not consts/types.
export async function logNonSaleOutgoing(
  cuttingIds: string[],
  reason: NonSaleOutgoingReason,
  notes?: string
): Promise<BatchActionResult> {
  const ids = dedupeIds(cuttingIds);
  if (ids.length === 0) {
    return { ok: false, message: "Nothing selected to log." };
  }
  if (!NON_SALE_OUTGOING_REASONS.includes(reason)) {
    return { ok: false, message: "Choose a valid reason." };
  }
  const trimmedNotes = notes?.trim() || null;
  if (reason === "Other" && !trimmedNotes) {
    return { ok: false, message: 'Describe the reason when "Other" is selected.' };
  }

  const supabase = getSupabaseServerClient();
  const { data: loggedCount, error } = await supabase.rpc("skrybix_push_cuttings_to_outgoing", {
    p_cutting_ids: ids,
    p_reason: reason,
    p_notes: trimmedNotes,
  });

  if (error) {
    return { ok: false, message: `Could not log outgoing cuttings: ${error.message}` };
  }

  const count = (loggedCount as number) ?? 0;
  const skipped = ids.length - count;

  ids.forEach((id) => revalidatePath(`/cuttings/${encodeURIComponent(id)}`));
  revalidatePath("/cuttings");
  revalidatePath("/outgoing");
  revalidatePath("/");
  return {
    ok: true,
    message:
      count === 0
        ? "Nothing new logged (already archived or unavailable)."
        : `${count} cutting${count === 1 ? "" : "s"} logged as ${reason} and archived.` +
          (skipped > 0 ? ` ${skipped} skipped (already archived or unavailable).` : ""),
  };
}

// Phase 2 workbench path: one explicit selection, then a reviewed outgoing
// reason. This replaces the risky global "push every sold row" UX while
// reusing the same atomic, idempotent database function from Reliability
// Phase 1. Skrybix records physical disposition only; sale price, customer,
// order, and channel remain Commercial Ledger responsibilities.
export async function logSelectedOutgoing(
  cuttingIds: string[],
  reason: OutgoingReason,
  notes?: string
): Promise<BatchActionResult> {
  const ids = dedupeIds(cuttingIds);
  if (ids.length === 0) return { ok: false, message: "Nothing selected to record." };
  if (!OUTGOING_REASONS.includes(reason)) return { ok: false, message: "Choose a valid outgoing reason." };
  const trimmedNotes = notes?.trim() || null;
  if (reason === "Other" && !trimmedNotes) {
    return { ok: false, message: 'Describe the reason when "Other" is selected.' };
  }

  const supabase = getSupabaseServerClient();
  const { data: loggedCount, error } = await supabase.rpc("skrybix_push_cuttings_to_outgoing", {
    p_cutting_ids: ids,
    p_reason: reason,
    p_notes: trimmedNotes,
  });
  if (error) return { ok: false, message: `Could not record outgoing cuttings: ${error.message}` };

  const count = (loggedCount as number) ?? 0;
  const skipped = ids.length - count;
  ids.forEach((id) => revalidatePath(`/cuttings/${encodeURIComponent(id)}`));
  revalidatePath("/cuttings");
  revalidatePath("/outgoing");
  revalidatePath("/");
  return {
    ok: true,
    message: count === 0
      ? "Nothing new recorded (already archived or unavailable)."
      : `${count} cutting${count === 1 ? "" : "s"} recorded as ${reason} and removed from active inventory.` +
        (skipped ? ` ${skipped} skipped (already archived or unavailable).` : ""),
  };
}
