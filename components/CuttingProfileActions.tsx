"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logSelectedOutgoing, queueCuttingsForPrint, toggleCuttingField } from "@/app/cuttings/actions";
import { CommerceSkuSelectionForm } from "@/components/CommerceSkuSelectionForm";
import { OUTGOING_REASONS, type OutgoingReason } from "@/lib/cuttings-batch";
import type { CommerceHandoffState } from "@/lib/commerce-export";

type Props = {
  cuttingId: string;
  archived: boolean;
  sold: boolean;
  printQueued: boolean;
  printCount: number;
  commerceState: CommerceHandoffState;
};

export default function CuttingProfileActions({ cuttingId, archived, sold, printQueued, printCount, commerceState }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [outgoingOpen, setOutgoingOpen] = useState(false);
  const [reason, setReason] = useState<OutgoingReason>("Sale");
  const [notes, setNotes] = useState("");

  async function queueLabel() {
    setBusy("label"); setMessage(null);
    const result = await queueCuttingsForPrint([cuttingId]);
    setBusy(null); setMessage({ ok: result.ok, text: result.message });
    if (result.ok) router.refresh();
  }

  async function toggleSold() {
    setBusy("sold"); setMessage(null);
    try {
      await toggleCuttingField(cuttingId, "sold", !sold);
      setMessage({ ok: true, text: sold ? "Cutting restored to active status." : "Cutting marked sold." });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Could not update the cutting." });
    } finally { setBusy(null); }
  }

  async function recordOutgoing() {
    setBusy("outgoing"); setMessage(null);
    const result = await logSelectedOutgoing([cuttingId], reason, notes);
    setBusy(null); setMessage({ ok: result.ok, text: result.message });
    if (result.ok) { setOutgoingOpen(false); router.refresh(); }
  }

  if (archived) {
    return <div className="outgoing-boundary"><strong>This cutting has left active inventory.</strong><span>Its permanent disposition record is shown below; operational actions are closed.</span></div>;
  }

  return <section className="card cutting-profile-actions">
    <div><p className="eyebrow">Current actions</p><h3>Work with this cutting</h3></div>
    {message && <div className={`flash ${message.ok ? "success" : "error"}`} role="status">{message.text}</div>}
    <div className="profile-secondary-actions">
      <button className="btn" type="button" disabled={Boolean(busy) || printQueued} onClick={queueLabel}>{printQueued ? "Label already queued" : busy === "label" ? "Queueing…" : printCount ? "Queue label reprint" : "Queue label"}</button>
      <button className="btn secondary" type="button" disabled={Boolean(busy)} onClick={toggleSold}>{busy === "sold" ? "Updating…" : sold ? "Restore active" : "Mark sold"}</button>
      <button className="btn secondary warm" type="button" disabled={Boolean(busy)} onClick={() => setOutgoingOpen((value) => !value)}>Record outgoing</button>
    </div>
    <div className="cutting-commerce-action"><strong>GM Commerce</strong><CommerceSkuSelectionForm kind="cutting" recordId={cuttingId} initialState={commerceState} /></div>
    {outgoingOpen && <div className="outgoing-confirmation">
      <p><strong>Record this exact cutting as leaving active inventory.</strong></p>
      <div className="outgoing-fields">
        <label><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value as OutgoingReason)}>{OUTGOING_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Notes {reason === "Other" ? "(required)" : "(optional)"}</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything worth remembering…" /></label>
      </div>
      <div className="profile-secondary-actions"><button className="btn warm" type="button" disabled={Boolean(busy) || (reason === "Other" && !notes.trim())} onClick={recordOutgoing}>{busy === "outgoing" ? "Recording…" : "Confirm and remove from active inventory"}</button><button className="btn secondary" type="button" onClick={() => setOutgoingOpen(false)}>Cancel</button></div>
    </div>}
  </section>;
}
