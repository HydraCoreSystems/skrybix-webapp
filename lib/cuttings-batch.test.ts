import assert from "node:assert/strict";
import test from "node:test";
import {
  commerceBatchMessage,
  computeCommerceBatch,
  computePrintQueueBatch,
  cuttingCommerceState,
  cuttingPrintState,
  isCommerceSelectable,
  isOutgoingSelectable,
  isPrintSelectable,
  printBatchMessage,
  toggleSelectAllVisible,
  type CuttingBatchRow,
} from "./cuttings-batch.ts";

function row(overrides: Partial<CuttingBatchRow>): CuttingBatchRow {
  return {
    cutting_id: "C1",
    print_label: false,
    label_print_count: 0,
    commerce_selected_at: null,
    commerce_acknowledged_at: null,
    ...overrides,
  };
}

// Production bug fix (2026-08-22): a previously-printed cutting used to be
// PERMANENTLY excluded from the print queue (isPrintSelectable returned
// false forever once label_print_count > 0), with no way back to
// selectable even though real labels sometimes need a legitimate reprint
// (alignment, printer, or physical label damage). The only state that
// makes a row ineligible is being CURRENTLY queued -- prior print history
// only changes the button's label, never its eligibility. The tests below
// cover the corrected behavior; see cuttingPrintState in cuttings-batch.ts.

test("cuttingPrintState: initial print -- a never-printed, unqueued row is selectable (Queue)", () => {
  assert.equal(cuttingPrintState({ print_label: false, label_print_count: 0 }), "selectable");
  assert.equal(isPrintSelectable({ print_label: false, label_print_count: 0 }), true);
});

test("cuttingPrintState: reprint eligibility -- a previously-printed, unqueued row stays selectable (Reprint)", () => {
  assert.equal(cuttingPrintState({ print_label: false, label_print_count: 1 }), "reprintable");
  assert.equal(isPrintSelectable({ print_label: false, label_print_count: 1 }), true);
  // Eligibility doesn't cap out after one reprint either.
  assert.equal(cuttingPrintState({ print_label: false, label_print_count: 5 }), "reprintable");
  assert.equal(isPrintSelectable({ print_label: false, label_print_count: 5 }), true);
});

test("cuttingPrintState: already-queued exclusion -- a queued row is never selectable, regardless of print history", () => {
  assert.equal(cuttingPrintState({ print_label: true, label_print_count: 0 }), "queued");
  assert.equal(isPrintSelectable({ print_label: true, label_print_count: 0 }), false);
  // A row can be queued again after prior prints -- still not selectable
  // while that queue entry is live.
  assert.equal(cuttingPrintState({ print_label: true, label_print_count: 3 }), "queued");
  assert.equal(isPrintSelectable({ print_label: true, label_print_count: 3 }), false);
});

test("cuttingCommerceState: acknowledged > selected > selectable", () => {
  assert.equal(cuttingCommerceState({ commerce_selected_at: null, commerce_acknowledged_at: null }), "selectable");
  assert.equal(cuttingCommerceState({ commerce_selected_at: "2026-01-01", commerce_acknowledged_at: null }), "selected");
  assert.equal(
    cuttingCommerceState({ commerce_selected_at: "2026-01-01", commerce_acknowledged_at: "2026-01-02" }),
    "acknowledged"
  );
  assert.equal(isCommerceSelectable({ commerce_selected_at: "2026-01-01", commerce_acknowledged_at: null }), false);
});

test("computePrintQueueBatch: multiple selected cuttings queue in one plan", () => {
  const rows = [row({ cutting_id: "C1" }), row({ cutting_id: "C2" }), row({ cutting_id: "C3" })];
  const plan = computePrintQueueBatch(["C1", "C2", "C3"], rows);
  assert.deepEqual(plan.toQueue, ["C1", "C2", "C3"]);
  assert.deepEqual(plan.alreadyQueued, []);
  assert.deepEqual(plan.skipped, []);
});

test("computePrintQueueBatch: retrying never creates duplicate queue entries", () => {
  const rows = [
    row({ cutting_id: "C1", print_label: true }),
    row({ cutting_id: "C2", print_label: false }),
    row({ cutting_id: "C3", print_label: true }),
  ];
  // Second submission of the same selected ids: already-queued ones are skipped.
  const plan = computePrintQueueBatch(["C1", "C2", "C3"], rows);
  assert.deepEqual(plan.toQueue, ["C2"]);
  assert.deepEqual(plan.alreadyQueued, ["C1", "C3"]);
  assert.deepEqual(plan.skipped, []);
  // Setting C2 to true and retrying again queues nothing new.
  const rowsAfter = rows.map((r) => (r.cutting_id === "C2" ? { ...r, print_label: true } : r));
  const retry = computePrintQueueBatch(["C1", "C2", "C3"], rowsAfter);
  assert.deepEqual(retry.toQueue, []);
  assert.deepEqual(retry.alreadyQueued, ["C1", "C2", "C3"]);
});

test("computePrintQueueBatch: a previously-printed, unqueued cutting can be re-queued for reprint", () => {
  const rows = [row({ cutting_id: "C1", print_label: false, label_print_count: 1 })];
  const plan = computePrintQueueBatch(["C1"], rows);
  assert.deepEqual(plan.toQueue, ["C1"]);
  assert.deepEqual(plan.alreadyQueued, []);
  assert.deepEqual(plan.skipped, []);
});

test("computePrintQueueBatch: unknown ids are skipped, not queued", () => {
  const rows = [row({ cutting_id: "C1" })];
  const plan = computePrintQueueBatch(["C1", "MISSING"], rows);
  assert.deepEqual(plan.toQueue, ["C1"]);
  assert.deepEqual(plan.skipped, ["MISSING"]);
});

test("computeCommerceBatch: already-selected rows are reported as skipped", () => {
  const rows = [
    row({ cutting_id: "C1", commerce_selected_at: "2026-01-01" }),
    row({ cutting_id: "C2" }),
  ];
  const plan = computeCommerceBatch(["C1", "C2"], rows);
  assert.deepEqual(plan.toSelect, ["C2"]);
  assert.deepEqual(plan.alreadySelected, ["C1"]);
});

test("toggleSelectAllVisible: selects all selectable visible rows for print", () => {
  const visible = [row({ cutting_id: "C1" }), row({ cutting_id: "C2" }), row({ cutting_id: "C3", print_label: true })];
  const next = toggleSelectAllVisible(visible, new Set(), "print");
  // C3 is already queued -> not selectable -> excluded.
  assert.deepEqual([...next].sort(), ["C1", "C2"]);
});

test("toggleSelectAllVisible: select-all-visible for print includes eligible reprints, excludes queued rows", () => {
  const visible = [
    row({ cutting_id: "C1", print_label: false, label_print_count: 0 }), // never printed
    row({ cutting_id: "C2", print_label: false, label_print_count: 1 }), // reprintable
    row({ cutting_id: "C3", print_label: true, label_print_count: 1 }), // currently queued -> excluded
  ];
  const next = toggleSelectAllVisible(visible, new Set(), "print");
  assert.deepEqual([...next].sort(), ["C1", "C2"]);
});

test("toggleSelectAllVisible: respects search/filter (only the passed rows)", () => {
  // Visible is the searched/filtered subset; rows outside it are never touched.
  const visible = [row({ cutting_id: "C1" })];
  const already = new Set(["C9"]); // present on page but not in this visible slice
  const next = toggleSelectAllVisible(visible, already, "print");
  assert.equal(next.has("C9"), true); // untouched
  assert.equal(next.has("C1"), true);
});

test("toggleSelectAllVisible: selecting all again deselects (toggle)", () => {
  const visible = [row({ cutting_id: "C1" }), row({ cutting_id: "C2" })];
  const selected = toggleSelectAllVisible(visible, new Set(), "print");
  const deselected = toggleSelectAllVisible(visible, selected, "print");
  assert.equal(deselected.has("C1"), false);
  assert.equal(deselected.has("C2"), false);
});

test("print and commerce selections are fully independent", () => {
  const rows = [row({ cutting_id: "C1" }), row({ cutting_id: "C2" })];
  const printSel = toggleSelectAllVisible(rows, new Set(), "print");
  // Selecting all for print must not affect commerce selection.
  const commerceSel = new Set<string>();
  assert.deepEqual([...printSel].sort(), ["C1", "C2"]);
  assert.equal(commerceSel.size, 0);
  // And a commerce select-all leaves the print selection untouched.
  const commerceSel2 = toggleSelectAllVisible(rows, new Set(), "commerce");
  assert.deepEqual([...commerceSel2].sort(), ["C1", "C2"]);
  assert.deepEqual([...printSel].sort(), ["C1", "C2"]);
});

test("printBatchMessage: reports queued and skipped totals honestly", () => {
  assert.equal(
    printBatchMessage({ toQueue: ["C1", "C2"], alreadyQueued: ["C3"], skipped: [] }),
    "2 labels queued for printing. 1 skipped (already queued or unavailable)."
  );
  assert.equal(printBatchMessage({ toQueue: ["C1"], alreadyQueued: [], skipped: [] }), "1 label queued for printing.");
  assert.equal(printBatchMessage({ toQueue: [], alreadyQueued: ["C1"], skipped: ["C2"] }), "No new labels queued (2 already queued or unavailable).");
});

test("commerceBatchMessage: reports sent and skipped totals honestly", () => {
  assert.equal(
    commerceBatchMessage({ toSelect: ["C1", "C2"], alreadySelected: ["C3"], skipped: [] }),
    "2 cuttings sent to GM Commerce. 1 skipped (already selected or unavailable)."
  );
  assert.equal(commerceBatchMessage({ toSelect: [], alreadySelected: ["C1"], skipped: [] }), "Nothing new sent (1 already selected or unavailable).");
});

test("isOutgoingSelectable: every row is eligible (no persisted queue state, unlike print/commerce)", () => {
  assert.equal(isOutgoingSelectable(row({ cutting_id: "C1" })), true);
  assert.equal(
    isOutgoingSelectable(row({ cutting_id: "C2", commerce_selected_at: "2026-01-01", print_label: true })),
    true
  );
});

test("toggleSelectAllVisible: outgoing mode selects all visible rows and is independent of print/commerce", () => {
  const rows = [row({ cutting_id: "C1" }), row({ cutting_id: "C2", print_label: true })];
  const outgoingSel = toggleSelectAllVisible(rows, new Set(), "outgoing");
  // Unlike print, an already-queued row is still selectable for outgoing.
  assert.deepEqual([...outgoingSel].sort(), ["C1", "C2"]);
  const printSel = toggleSelectAllVisible(rows, new Set(), "print");
  assert.deepEqual([...printSel].sort(), ["C1"]);
});
