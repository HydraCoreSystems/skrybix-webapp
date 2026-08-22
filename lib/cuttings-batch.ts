// Cuttings page — pure batch-selection logic.
//
// Kept free of Next/Supabase runtime so the batch rules (what is selectable,
// what a re-queue does, what "select all visible" means) are plain, testable
// functions. The server actions orchestrate the database; the client table
// component drives the UI; this module holds the honest decision logic.
//
// Print and GM Commerce selections are deliberately independent: they are
// separate Sets with no cross-talk (selecting for print never selects for GM
// Commerce and vice versa). The only shared concept is which rows are
// currently visible after search/filter — see toggleSelectAllVisible.

// Non-sale outgoing reasons -- shared between app/cuttings/actions.ts
// (server-side validation) and CuttingsBatchTable.tsx (the reason
// dropdown). Lives here, not in actions.ts, because a "use server" file
// may only export async functions, not consts/types.
export const NON_SALE_OUTGOING_REASONS = ["Gift", "Loss", "Disposal", "Trade", "Personal Use", "Other"] as const;
export type NonSaleOutgoingReason = (typeof NON_SALE_OUTGOING_REASONS)[number];

export type CuttingPrintState = "selectable" | "queued" | "printed";

export type CuttingCommerceState = "selectable" | "selected" | "acknowledged";

/** The subset of a cutting row the batch logic needs. */
export interface CuttingBatchRow {
  cutting_id: string;
  print_label: boolean;
  label_print_count: number;
  commerce_selected_at: string | null;
  commerce_acknowledged_at: string | null;
}

// ---- Per-row status -------------------------------------------------------

/** Print status: only never-queued-and-never-printed rows get an active
 *  checkbox; already-queued (Queued) and previously-printed (Printed) rows
 *  must show an honest status instead of a selectable control. */
export function cuttingPrintState(c: Pick<CuttingBatchRow, "print_label" | "label_print_count">): CuttingPrintState {
  if (c.print_label) return "queued";
  if (c.label_print_count > 0) return "printed";
  return "selectable";
}

export function cuttingCommerceState(
  c: Pick<CuttingBatchRow, "commerce_selected_at" | "commerce_acknowledged_at">
): CuttingCommerceState {
  if (c.commerce_acknowledged_at) return "acknowledged";
  if (c.commerce_selected_at) return "selected";
  return "selectable";
}

export function isPrintSelectable(c: Pick<CuttingBatchRow, "print_label" | "label_print_count">): boolean {
  return cuttingPrintState(c) === "selectable";
}

export function isCommerceSelectable(
  c: Pick<CuttingBatchRow, "commerce_selected_at" | "commerce_acknowledged_at">
): boolean {
  return cuttingCommerceState(c) === "selectable";
}

// Non-sale outgoing logging has no persisted "queued"/"selected" state of
// its own (unlike print/commerce) -- it's an immediate action, not a
// queue. Every row the Cuttings page renders is already filtered to
// archived_at is null (see app/cuttings/page.tsx), so any visible row is
// eligible to be logged as outgoing. This predicate exists mainly so
// "select all visible" can share the same toggleSelectAllVisible logic
// as the print/commerce modes below.
export function isOutgoingSelectable(_c: CuttingBatchRow): boolean {
  return true;
}

// ---- "Select all visible" -------------------------------------------------

/**
 * "Visible" means the rows currently displayed after search/filter (the caller
 * passes exactly those rows — never the whole database). Toggling selects (or
 * unselects) every currently-selectable visible row for the given mode. The
 * two modes share nothing; each call operates only on its own mode's Set.
 */
export function toggleSelectAllVisible(
  visibleRows: readonly CuttingBatchRow[],
  currentSelection: ReadonlySet<string>,
  mode: "print" | "commerce" | "outgoing"
): Set<string> {
  const predicate =
    mode === "print" ? isPrintSelectable : mode === "commerce" ? isCommerceSelectable : isOutgoingSelectable;
  const selectableVisible = new Set(visibleRows.filter(predicate).map((r) => r.cutting_id));

  const next = new Set(currentSelection);
  // Are all selectable-visible rows already selected? If so, this is a "deselect
  // all visible" toggle; otherwise select all visible selectable rows.
  let allSelected = selectableVisible.size > 0;
  for (const id of selectableVisible) {
    if (!next.has(id)) {
      allSelected = false;
      break;
    }
  }

  if (allSelected) {
    for (const id of selectableVisible) next.delete(id);
  } else {
    for (const id of selectableVisible) next.add(id);
  }
  return next;
}

// ---- Batch result computation ---------------------------------------------

export interface PrintBatchPlan {
  /** ids to set print_label = true */
  toQueue: string[];
  /** ids already queued (skipped, no-op) */
  alreadyQueued: string[];
  /** ids that could not be queued (unknown/not present in current rows) */
  skipped: string[];
}

export interface CommerceBatchPlan {
  /** ids to mark selected for GM Commerce */
  toSelect: string[];
  /** ids already selected (skipped, no-op) */
  alreadySelected: string[];
  /** ids that could not be selected (unknown/not present) */
  skipped: string[];
}

/**
 * Computes the honest plan for a batch "queue for print" submission against
 * the CURRENT database rows for exactly the selected ids. A retry converges:
 * already-queued ids move to alreadyQueued and never appear in toQueue, so no
 * duplicate queue entry can be created (the queue is a boolean flag, and a
 * repeat submission simply re-queues nothing new).
 */
export function computePrintQueueBatch(
  selectedIds: readonly string[],
  currentRows: readonly CuttingBatchRow[]
): PrintBatchPlan {
  const byId = new Map(currentRows.map((r) => [r.cutting_id, r]));
  const plan: PrintBatchPlan = { toQueue: [], alreadyQueued: [], skipped: [] };
  for (const id of selectedIds) {
    const row = byId.get(id);
    if (!row) {
      plan.skipped.push(id);
    } else if (row.print_label) {
      plan.alreadyQueued.push(id);
    } else {
      plan.toQueue.push(id);
    }
  }
  return plan;
}

export function computeCommerceBatch(
  selectedIds: readonly string[],
  currentRows: readonly CuttingBatchRow[]
): CommerceBatchPlan {
  const byId = new Map(currentRows.map((r) => [r.cutting_id, r]));
  const plan: CommerceBatchPlan = { toSelect: [], alreadySelected: [], skipped: [] };
  for (const id of selectedIds) {
    const row = byId.get(id);
    if (!row) {
      plan.skipped.push(id);
    } else if (row.commerce_selected_at) {
      plan.alreadySelected.push(id);
    } else {
      plan.toSelect.push(id);
    }
  }
  return plan;
}

// ---- Plain-language result messages ---------------------------------------

export function printBatchMessage(plan: PrintBatchPlan): string {
  const queued = plan.toQueue.length;
  const skipped = plan.alreadyQueued.length + plan.skipped.length;
  if (queued === 0) {
    return skipped > 0 ? `No new labels queued (${skipped} already queued or unavailable).` : "Nothing selected to queue.";
  }
  const base = queued === 1 ? "1 label queued for printing." : `${queued} labels queued for printing.`;
  if (skipped > 0) {
    return `${base} ${skipped} skipped (already queued or unavailable).`;
  }
  return base;
}

export function commerceBatchMessage(plan: CommerceBatchPlan): string {
  const sent = plan.toSelect.length;
  const skipped = plan.alreadySelected.length + plan.skipped.length;
  if (sent === 0) {
    return skipped > 0 ? `Nothing new sent (${skipped} already selected or unavailable).` : "Nothing selected to send.";
  }
  const base = sent === 1 ? "1 cutting sent to GM Commerce." : `${sent} cuttings sent to GM Commerce.`;
  if (skipped > 0) {
    return `${base} ${skipped} skipped (already selected or unavailable).`;
  }
  return base;
}
