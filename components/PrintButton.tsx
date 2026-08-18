"use client";

import { useEffect, useState } from "react";

// The browser's Print API has no reliable "the user actually printed (vs.
// hit Cancel)" signal -- `afterprint` fires either way, in every browser,
// by design (MDN is explicit about this). Auto-clearing the print queue on
// `afterprint` alone would violate "failed print -> remain queued/retryable"
// every time Phil cancels the OS print dialog (wrong printer selected, out
// of paper noticed at the last second, etc.).
//
// So the real "it printed" signal here is Phil's own explicit confirmation,
// surfaced right after the dialog closes (via `afterprint`) rather than
// buried behind a separate button he has to remember to go find. Ignoring
// the prompt (closing the tab, navigating away) leaves the queue exactly as
// it was -- the safe default is "still queued", never "assume it printed".
export default function PrintButton({
  ids,
  onConfirmPrinted,
}: {
  ids: string[];
  onConfirmPrinted: (ids: string[]) => Promise<void>;
}) {
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    function handleAfterPrint() {
      setAwaitingConfirm(true);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  async function handleConfirm(printed: boolean) {
    setAwaitingConfirm(false);
    if (!printed) return;
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
        onClick={() => window.print()}
      >
        Print
      </button>
      {awaitingConfirm && (
        <span
          role="alert"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <span>Did that print correctly?</span>
          <button className="btn small" type="button" onClick={() => handleConfirm(true)}>
            Yes, clear {ids.length} from queue
          </button>
          <button className="btn small secondary" type="button" onClick={() => handleConfirm(false)}>
            No / keep queued
          </button>
        </span>
      )}
      {confirming && <span>Updating queue…</span>}
      {confirmError && (
        <span role="alert" className="flash error" style={{ padding: "4px 10px" }}>
          {confirmError}
        </span>
      )}
    </span>
  );
}
