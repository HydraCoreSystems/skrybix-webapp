import type { Cutting } from "@/lib/types";

export type CuttingInventoryState = "Active inventory" | "Marked sold" | "Outgoing / archived";
export type CuttingHandoffLabel = "Not sent" | "Waiting" | "Received";

export function cuttingInventoryState(cutting: Pick<Cutting, "archived_at" | "sold">): CuttingInventoryState {
  if (cutting.archived_at) return "Outgoing / archived";
  if (cutting.sold) return "Marked sold";
  return "Active inventory";
}

export function cuttingHandoffLabel(
  cutting: Pick<Cutting, "commerce_selected_at" | "commerce_acknowledged_at">
): CuttingHandoffLabel {
  if (cutting.commerce_acknowledged_at) return "Received";
  if (cutting.commerce_selected_at) return "Waiting";
  return "Not sent";
}
