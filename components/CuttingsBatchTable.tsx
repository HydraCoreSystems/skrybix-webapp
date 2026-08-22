"use client";

import { useState } from "react";
import { logNonSaleOutgoing, queueCuttingsForPrint, sendCuttingsToCommerce, toggleCuttingField } from "@/app/cuttings/actions";
import {
  cuttingPrintState,
  isCommerceSelectable,
  isOutgoingSelectable,
  isPrintSelectable,
  NON_SALE_OUTGOING_REASONS,
  toggleSelectAllVisible,
  type CuttingBatchRow,
  type NonSaleOutgoingReason,
} from "@/lib/cuttings-batch";

export interface CuttingsTableRow extends CuttingBatchRow {
  motherDisplayName: string | null;
  motherId: string;
  dateTaken: string | null;
  label_last_printed_at: string | null;
  sold: boolean;
  // scan_count (the aggregate QR-label scan total) is retained on the data
  // model and passed through, but is intentionally NOT rendered: newly printed
  // labels link directly to Instagram, so they never hit Skrybix's counting
  // route and cannot increment this counter. The counter is kept only for
  // legacy labels that still carry the old Skrybix-URL QR. Presentation-only.
  scan_count: number;
}

function printedLabelText(row: CuttingsTableRow): string | null {
  if (!row.label_print_count || row.label_print_count < 1) return null;
  if (!row.label_last_printed_at) return `Printed ${row.label_print_count}x`;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(row.label_last_printed_at));
  return `Printed ${when} - ${row.label_print_count}x`;
}

type ResultMessage = { kind: "success" | "error"; text: string } | null;

export default function CuttingsBatchTable({ rows }: { rows: CuttingsTableRow[] }) {
  const [printSel, setPrintSel] = useState<ReadonlySet<string>>(new Set());
  const [commerceSel, setCommerceSel] = useState<ReadonlySet<string>>(new Set());
  const [outgoingSel, setOutgoingSel] = useState<ReadonlySet<string>>(new Set());
  const [outgoingReason, setOutgoingReason] = useState<NonSaleOutgoingReason>(NON_SALE_OUTGOING_REASONS[0]);
  const [outgoingNotes, setOutgoingNotes] = useState("");
  const [message, setMessage] = useState<ResultMessage>(null);
  const [busy, setBusy] = useState<"print" | "commerce" | "outgoing" | null>(null);
  const [sold, setSold] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.cutting_id, r.sold]))
  );

  const printSelectableIds = rows.filter(isPrintSelectable).map((r) => r.cutting_id);
  const commerceSelectableIds = rows.filter(isCommerceSelectable).map((r) => r.cutting_id);
  const outgoingSelectableIds = rows.filter(isOutgoingSelectable).map((r) => r.cutting_id);

  const printAllSelected =
    printSelectableIds.length > 0 && printSelectableIds.every((id) => printSel.has(id));
  const printSomeSelected = printSelectableIds.some((id) => printSel.has(id));
  const commerceAllSelected =
    commerceSelectableIds.length > 0 && commerceSelectableIds.every((id) => commerceSel.has(id));
  const commerceSomeSelected = commerceSelectableIds.some((id) => commerceSel.has(id));
  const outgoingAllSelected =
    outgoingSelectableIds.length > 0 && outgoingSelectableIds.every((id) => outgoingSel.has(id));
  const outgoingSomeSelected = outgoingSelectableIds.some((id) => outgoingSel.has(id));

  function togglePrint(id: string) {
    setPrintSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCommerce(id: string) {
    setCommerceSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOutgoing(id: string) {
    setOutgoingSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAllPrint() {
    setPrintSel((prev) => toggleSelectAllVisible(rows, prev, "print"));
  }

  function handleSelectAllCommerce() {
    setCommerceSel((prev) => toggleSelectAllVisible(rows, prev, "commerce"));
  }

  function handleSelectAllOutgoing() {
    setOutgoingSel((prev) => toggleSelectAllVisible(rows, prev, "outgoing"));
  }

  async function submitPrint() {
    setBusy("print");
    setMessage(null);
    const result = await queueCuttingsForPrint([...printSel]);
    setBusy(null);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setPrintSel(new Set());
    setMessage({ kind: "success", text: result.message });
  }

  async function submitCommerce() {
    setBusy("commerce");
    setMessage(null);
    const result = await sendCuttingsToCommerce([...commerceSel]);
    setBusy(null);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setCommerceSel(new Set());
    setMessage({ kind: "success", text: result.message });
  }

  async function submitOutgoing() {
    setBusy("outgoing");
    setMessage(null);
    const result = await logNonSaleOutgoing([...outgoingSel], outgoingReason, outgoingNotes);
    setBusy(null);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setOutgoingSel(new Set());
    setOutgoingNotes("");
    setMessage({ kind: "success", text: result.message });
  }

  async function toggleSold(cuttingId: string) {
    const next = !sold[cuttingId];
    setSold((prev) => ({ ...prev, [cuttingId]: next }));
    // toggleCuttingField now throws on a DB error (see app/cuttings/actions.ts)
    // instead of silently no-op'ing. This is a direct client-side call, not a
    // <form action> submit, so an unhandled rejection here would otherwise be
    // swallowed by the browser with no visible failure -- revert the
    // optimistic flip and show the real error instead.
    try {
      await toggleCuttingField(cuttingId, "sold", next);
    } catch (err) {
      setSold((prev) => ({ ...prev, [cuttingId]: !next }));
      setMessage({ kind: "error", text: err instanceof Error ? err.message : `Could not update ${cuttingId}.` });
    }
  }

  return (
    <>
      {message && (
        <div className={`flash ${message.kind}`} role="status">
          {message.text}
        </div>
      )}

      <div className="batch-actions">
        <button
          className="btn"
          type="button"
          disabled={printSel.size === 0 || busy !== null}
          onClick={submitPrint}
        >
          {busy === "print" ? "Queueing..." : "Queue selected for print"}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={commerceSel.size === 0 || busy !== null}
          onClick={submitCommerce}
        >
          {busy === "commerce" ? "Sending..." : "Send selected to GM Commerce"}
        </button>
      </div>

      {/* Non-sale outgoing: records why a cutting left inventory when it
          wasn't a GM Commerce sale (gift, loss, disposal, trade, personal
          use) -- see logNonSaleOutgoing in app/cuttings/actions.ts. This is
          deliberately separate from "Mark sold" / "Push Sold -> Outgoing
          Log" above, which is unchanged. */}
      <div className="batch-actions" style={{ marginTop: 8 }}>
        <label>
          Reason:{" "}
          <select
            value={outgoingReason}
            onChange={(e) => setOutgoingReason(e.target.value as NonSaleOutgoingReason)}
          >
            {NON_SALE_OUTGOING_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>{" "}
        {outgoingReason === "Other" && (
          <input
            type="text"
            placeholder="Describe the reason (required for Other)"
            value={outgoingNotes}
            onChange={(e) => setOutgoingNotes(e.target.value)}
            style={{ width: 260 }}
          />
        )}{" "}
        <button
          className="btn secondary"
          type="button"
          disabled={outgoingSel.size === 0 || busy !== null}
          onClick={submitOutgoing}
        >
          {busy === "outgoing" ? "Logging..." : "Log outgoing (non-sale)"}
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Cutting ID</th>
            <th>Mother</th>
            <th>Date Taken</th>
            <th>Sold?</th>
            <th>
              <span className="batch-col-head">
                Print
                <input
                  type="checkbox"
                  aria-label="Select all visible cuttings for print"
                  checked={printAllSelected}
                  onChange={handleSelectAllPrint}
                  ref={(el) => {
                    if (el) el.indeterminate = printSomeSelected && !printAllSelected;
                  }}
                />
              </span>
            </th>
            <th>
              <span className="batch-col-head">
                GM Commerce
                <input
                  type="checkbox"
                  aria-label="Select all visible cuttings for GM Commerce"
                  checked={commerceAllSelected}
                  onChange={handleSelectAllCommerce}
                  ref={(el) => {
                    if (el) el.indeterminate = commerceSomeSelected && !commerceAllSelected;
                  }}
                />
              </span>
            </th>
            <th>
              <span className="batch-col-head">
                Outgoing (non-sale)
                <input
                  type="checkbox"
                  aria-label="Select all visible cuttings for non-sale outgoing"
                  checked={outgoingAllSelected}
                  onChange={handleSelectAllOutgoing}
                  ref={(el) => {
                    if (el) el.indeterminate = outgoingSomeSelected && !outgoingAllSelected;
                  }}
                />
              </span>
            </th>
            {/* "Label Scans" column is intentionally absent: newly printed
                labels link directly to Instagram, so scan_count cannot
                increment. scan_count remains on the row model for legacy
                labels; see the CuttingsTableRow comment. */}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const history = printedLabelText(c);
            return (
              <tr key={c.cutting_id}>
                <td>{c.cutting_id}</td>
                <td>
                  {c.motherDisplayName} ({c.motherId})
                </td>
                <td>{c.dateTaken}</td>
                <td>
                  <button
                    className={`btn small ${sold[c.cutting_id] ? "" : "secondary"}`}
                    type="button"
                    onClick={() => toggleSold(c.cutting_id)}
                  >
                    {sold[c.cutting_id] ? "Sold ✓" : "Mark sold"}
                  </button>
                </td>
                <td>
                  {isPrintSelectable(c) ? (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={printSel.has(c.cutting_id)}
                        onChange={() => togglePrint(c.cutting_id)}
                      />{" "}
                      {cuttingPrintState(c) === "reprintable" ? "Reprint" : "Queue"}
                    </label>
                  ) : (
                    // The only non-selectable print state is "queued" -- a
                    // prior print history no longer makes a row permanently
                    // ineligible (see cuttingPrintState in lib/cuttings-batch.ts).
                    <span>Queued ✓</span>
                  )}
                  {history && <small style={{ display: "block", marginTop: 5 }}>{history}</small>}
                </td>
                <td>
                  {isCommerceSelectable(c) ? (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={commerceSel.has(c.cutting_id)}
                        onChange={() => toggleCommerce(c.cutting_id)}
                      />{" "}
                      Send
                    </label>
                  ) : c.commerce_acknowledged_at ? (
                    <span>Received by GM Commerce</span>
                  ) : (
                    <span>Selected for GM Commerce</span>
                  )}
                </td>
                <td>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={outgoingSel.has(c.cutting_id)}
                      onChange={() => toggleOutgoing(c.cutting_id)}
                    />{" "}
                    Select
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
