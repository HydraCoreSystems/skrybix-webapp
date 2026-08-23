"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { logSelectedOutgoing, queueCuttingsForPrint, sendCuttingsToCommerce, toggleCuttingField } from "@/app/cuttings/actions";
import { cuttingCommerceState, cuttingPrintState, OUTGOING_REASONS, toggleUnifiedSelection, type CuttingBatchRow, type OutgoingReason } from "@/lib/cuttings-batch";

export interface CuttingsTableRow extends CuttingBatchRow {
  motherDisplayName: string | null;
  motherId: string;
  dateTaken: string | null;
  label_last_printed_at: string | null;
  sold: boolean;
  scan_count: number;
}

function printedLabelText(row: CuttingsTableRow): string | null {
  if (!row.label_print_count || row.label_print_count < 1) return null;
  if (!row.label_last_printed_at) return `Printed ${row.label_print_count}x`;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(row.label_last_printed_at));
  return `Printed ${when} · ${row.label_print_count}x`;
}

type ResultMessage = { kind: "success" | "error"; text: string } | null;

export default function CuttingsBatchTable({ rows }: { rows: CuttingsTableRow[] }) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [outgoingOpen, setOutgoingOpen] = useState(false);
  const [outgoingReason, setOutgoingReason] = useState<OutgoingReason>("Sale");
  const [outgoingNotes, setOutgoingNotes] = useState("");
  const [message, setMessage] = useState<ResultMessage>(null);
  const [busy, setBusy] = useState<"print" | "commerce" | "outgoing" | null>(null);
  const [sold, setSold] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((row) => [row.cutting_id, row.sold])));

  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.cutting_id)), [rows, selection]);
  const allSelected = rows.length > 0 && rows.every((row) => selection.has(row.cutting_id));
  const someSelected = rows.some((row) => selection.has(row.cutting_id));

  function toggleOne(id: string) {
    setSelection((current) => toggleUnifiedSelection(current, id));
  }

  function toggleAll() {
    setSelection((current) => {
      const next = new Set(current);
      if (allSelected) rows.forEach((row) => next.delete(row.cutting_id));
      else rows.forEach((row) => next.add(row.cutting_id));
      return next;
    });
  }

  async function runAction(kind: "print" | "commerce") {
    setBusy(kind);
    setMessage(null);
    const result = kind === "print" ? await queueCuttingsForPrint([...selection]) : await sendCuttingsToCommerce([...selection]);
    setBusy(null);
    setMessage({ kind: result.ok ? "success" : "error", text: result.message });
    if (result.ok) setSelection(new Set());
  }

  async function submitOutgoing() {
    setBusy("outgoing");
    setMessage(null);
    const result = await logSelectedOutgoing([...selection], outgoingReason, outgoingNotes);
    setBusy(null);
    setMessage({ kind: result.ok ? "success" : "error", text: result.message });
    if (result.ok) {
      setSelection(new Set());
      setOutgoingOpen(false);
      setOutgoingNotes("");
    }
  }

  async function toggleSold(cuttingId: string) {
    const next = !sold[cuttingId];
    setSold((current) => ({ ...current, [cuttingId]: next }));
    try {
      await toggleCuttingField(cuttingId, "sold", next);
    } catch (error) {
      setSold((current) => ({ ...current, [cuttingId]: !next }));
      setMessage({ kind: "error", text: error instanceof Error ? error.message : `Could not update ${cuttingId}.` });
    }
  }

  if (rows.length === 0) {
    return <div className="worklist-empty"><strong>No active cuttings match this work queue.</strong><p>Clear the filters or choose another queue.</p></div>;
  }

  return (
    <>
      {message && <div className={`flash ${message.kind}`} role="status">{message.text}</div>}

      <div className={`selection-action-bar ${selection.size ? "active" : ""}`}>
        <div><strong>{selection.size ? `${selection.size} selected` : "Select cuttings to begin"}</strong><span>One selection works across labels, GM Commerce, and outgoing.</span></div>
        <div className="actions">
          <button className="btn" type="button" disabled={!selection.size || busy !== null} onClick={() => runAction("print")}>{busy === "print" ? "Queueing…" : "Queue / reprint labels"}</button>
          <button className="btn secondary" type="button" disabled={!selection.size || busy !== null} onClick={() => runAction("commerce")}>{busy === "commerce" ? "Sending…" : "Send to GM Commerce"}</button>
          <button className="btn secondary warm" type="button" disabled={!selection.size || busy !== null} onClick={() => setOutgoingOpen(true)}>Record outgoing</button>
        </div>
      </div>

      {outgoingOpen && (
        <section className="outgoing-confirmation" role="dialog" aria-labelledby="outgoing-title">
          <div className="outgoing-confirmation-heading">
            <div><p className="eyebrow">Final inventory action</p><h3 id="outgoing-title">Confirm {selection.size} outgoing cutting{selection.size === 1 ? "" : "s"}</h3></div>
            <button className="btn small secondary" type="button" onClick={() => setOutgoingOpen(false)}>Cancel</button>
          </div>
          <p>These exact cuttings will be recorded in the Outgoing Log and removed from active inventory:</p>
          <div className="selected-id-list">{selectedRows.map((row) => <code key={row.cutting_id}>{row.cutting_id}</code>)}</div>
          <div className="outgoing-fields">
            <label><span>Reason</span><select value={outgoingReason} onChange={(event) => setOutgoingReason(event.target.value as OutgoingReason)}>{OUTGOING_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
            <label><span>Notes {outgoingReason === "Other" ? "(required)" : "(optional)"}</span><input value={outgoingNotes} onChange={(event) => setOutgoingNotes(event.target.value)} placeholder="Anything worth remembering…" /></label>
          </div>
          <button className="btn warm" type="button" disabled={busy !== null || (outgoingReason === "Other" && !outgoingNotes.trim())} onClick={submitOutgoing}>{busy === "outgoing" ? "Recording…" : `Confirm and remove ${selection.size} from active inventory`}</button>
        </section>
      )}

      <div className="worklist-table-wrap">
        <table className="worklist-table">
          <thead><tr>
            <th><input type="checkbox" aria-label="Select all cuttings on this page" checked={allSelected} onChange={toggleAll} ref={(element) => { if (element) element.indeterminate = someSelected && !allSelected; }} /></th>
            <th>Cutting</th><th>Mother plant</th><th>Date taken</th><th>Label</th><th>GM Commerce</th><th>Sold?</th>
          </tr></thead>
          <tbody>{rows.map((row) => {
            const printState = cuttingPrintState(row);
            const commerceState = cuttingCommerceState(row);
            const selected = selection.has(row.cutting_id);
            return <tr key={row.cutting_id} className={selected ? "selected" : ""}>
              <td><input type="checkbox" aria-label={`Select ${row.cutting_id}`} checked={selected} onChange={() => toggleOne(row.cutting_id)} /></td>
              <td><strong><Link href={`/cuttings/${encodeURIComponent(row.cutting_id)}`}>{row.cutting_id}</Link></strong></td>
              <td><span><Link href={`/mothers/${encodeURIComponent(row.motherId)}`}>{row.motherDisplayName || "Unnamed mother"}</Link></span><small>{row.motherId}</small></td>
              <td>{row.dateTaken || "—"}</td>
              <td><span className={`status-pill ${printState}`}>{printState === "queued" ? "Queued" : printState === "reprintable" ? "Reprint available" : "Not printed"}</span>{printedLabelText(row) && <small>{printedLabelText(row)}</small>}</td>
              <td><span className={`status-pill commerce-${commerceState}`}>{commerceState === "acknowledged" ? "Received" : commerceState === "selected" ? "Waiting" : "Ready"}</span></td>
              <td><button className={`btn small ${sold[row.cutting_id] ? "" : "secondary"}`} type="button" onClick={() => toggleSold(row.cutting_id)}>{sold[row.cutting_id] ? "Sold ✓" : "Mark sold"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </>
  );
}
