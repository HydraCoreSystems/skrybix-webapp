"use client";

import { useState } from "react";

// Browsers cannot report whether the native print dialog completed or was
// cancelled. For this owner-operated workflow, closing the dialog is treated
// as completion: it removes the exact displayed batch from the queue and
// records a durable timestamp/count. A failed database update leaves the
// batch queued and surfaces an error.
export default function PrintButton({
  ids,
  onConfirmPrinted,
}: {
  ids: string[];
  onConfirmPrinted: (ids: string[]) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function handlePrint() {
    window.print();
    setConfirming(true);
    setConfirmError(null);
    try {
      await onConfirmPrinted(ids);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Could not update the print queue.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        className="btn"
        type="button"
        disabled={ids.length === 0 || confirming}
        onClick={handlePrint}
      >
        {confirming ? "Recording print…" : "Print labels"}
      </button>
      <small>Closing the print dialog records this batch as printed.</small>
      {confirmError && (
        <span role="alert" className="flash error" style={{ padding: "4px 10px" }}>
          {confirmError}
        </span>
      )}
    </span>
  );
}
