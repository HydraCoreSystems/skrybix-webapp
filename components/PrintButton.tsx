"use client";

import { useState } from "react";

// Browsers cannot report whether the native print dialog completed, was
// cancelled, or whether the physical print job actually reached paper --
// window.print() returning tells you nothing about the printer itself.
// This USED to treat calling window.print() as completion and clear the
// queue immediately; a real print failure (wrong printer selected, out of
// stock, a stuck spooler -- all outside this app's visibility) then looked
// identical to a successful print, silently losing the queued batch with
// nothing to show for it. Fixed 2026-09-05 after exactly that happened to
// a real batch of cutting labels: now it's a real, explicit owner
// confirmation after the print dialog closes -- "did these print?" -- and
// the batch only clears from the queue on "Yes". "No" leaves it queued so
// the owner can just try again without re-selecting anything.
export default function PrintButton({
  ids,
  onConfirmPrinted,
}: {
  ids: string[];
  onConfirmPrinted: (ids: string[]) => Promise<void>;
}) {
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  function handlePrint() {
    window.print();
    setConfirmError(null);
    setAwaitingConfirmation(true);
  }

  async function confirmPrinted() {
    setConfirming(true);
    setConfirmError(null);
    try {
      await onConfirmPrinted(ids);
      setAwaitingConfirmation(false);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Could not update the print queue.");
    } finally {
      setConfirming(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <span className="outgoing-confirmation" style={{ display: "inline-flex", flexDirection: "column", gap: 8 }}>
        {confirmError && (
          <span role="alert" className="flash error">
            {confirmError}
          </span>
        )}
        <strong>Did these {ids.length} label{ids.length === 1 ? "" : "s"} actually print?</strong>
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" disabled={confirming} onClick={confirmPrinted}>
            {confirming ? "Recording…" : "Yes, printed successfully"}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={confirming}
            onClick={() => {
              setAwaitingConfirmation(false);
              setConfirmError(null);
            }}
          >
            No / it failed -- keep queued
          </button>
        </span>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button className="btn" type="button" disabled={ids.length === 0} onClick={handlePrint}>
        Print labels
      </button>
      <small>You&apos;ll be asked to confirm the print worked before this batch leaves the queue.</small>
    </span>
  );
}
