import assert from "node:assert/strict";
import test from "node:test";
import { cuttingHandoffLabel, cuttingInventoryState } from "./cutting-profile.ts";

test("active cutting is shown as active inventory", () => {
  assert.equal(cuttingInventoryState({ archived_at: null, sold: false }), "Active inventory");
});

test("sold marker is visible before physical disposition", () => {
  assert.equal(cuttingInventoryState({ archived_at: null, sold: true }), "Marked sold");
});

test("archive/disposition takes precedence over the sold marker", () => {
  assert.equal(cuttingInventoryState({ archived_at: "2026-08-22T12:00:00Z", sold: true }), "Outgoing / archived");
});

test("commerce handoff labels distinguish unsent, waiting, and received", () => {
  assert.equal(cuttingHandoffLabel({ commerce_selected_at: null, commerce_acknowledged_at: null }), "Not sent");
  assert.equal(cuttingHandoffLabel({ commerce_selected_at: "2026-08-22T12:00:00Z", commerce_acknowledged_at: null }), "Waiting");
  assert.equal(cuttingHandoffLabel({ commerce_selected_at: "2026-08-22T12:00:00Z", commerce_acknowledged_at: "2026-08-22T12:01:00Z" }), "Received");
});
