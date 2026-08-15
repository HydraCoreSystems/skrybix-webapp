"use client";

import { useState } from "react";
import { selectCuttingForCommerce } from "@/app/cuttings/actions";
import { selectMotherForCommerce } from "@/app/mothers/actions";
import type { CommerceHandoffState } from "@/lib/commerce-export";
import type { PhotoSubject, ShippingPresentation } from "@/lib/commerce-sku";

// OWNER DECISION (existing-ID-as-SKU correction): the record's own
// mother_id/cutting_id IS the commerce/Shopify SKU -- there is no
// separate genus/plant-code identity to choose or create here anymore.
// Selecting a cutting requires only an explicit confirmation; selecting
// a mother still requires the required sale facts, but no code inputs.

type Props = {
  kind: "cutting" | "mother";
  recordId: string;
  initialState: CommerceHandoffState;
};

export function CommerceSkuSelectionForm({ kind, recordId, initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Mother-only required facts (design report / CLAUDE.md decision
  // record) -- deliberately never defaulted or inferred, every field
  // here must come from an explicit choice.
  const [photoSubject, setPhotoSubject] = useState<PhotoSubject>("exact_plant");
  const [potSize, setPotSize] = useState("");
  const [plantSize, setPlantSize] = useState("");
  const [rootedEstablished, setRootedEstablished] = useState(false);
  const [shippingPresentation, setShippingPresentation] = useState<ShippingPresentation>("ships_in_pot");
  const [shippingDetail, setShippingDetail] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");

  if (state === "acknowledged") {
    return <span>Received by GM Commerce ({recordId})</span>;
  }
  if (state === "selected") {
    return <span>Selected for GM Commerce ({recordId})</span>;
  }

  async function submit() {
    setBusy(true);
    setMessage(null);

    const result =
      kind === "cutting"
        ? await selectCuttingForCommerce(recordId)
        : await selectMotherForCommerce(recordId, {
            photoSubject,
            potSize,
            plantSize,
            rootedEstablished,
            shippingPresentation,
            shippingPresentationDetail: shippingPresentation === "prepared_other" ? shippingDetail : null,
            conditionNotes: conditionNotes || null,
          });

    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setState("selected");
  }

  if (!open) {
    return (
      <label>
        <input type="checkbox" checked={false} onChange={(e) => e.target.checked && setOpen(true)} /> Select for GM
        Commerce
      </label>
    );
  }

  return (
    <div className="card" style={{ padding: 14, margin: 0 }}>
      <p>
        <strong>Shopify SKU:</strong> {recordId}
      </p>

      {kind === "mother" && (
        <>
          <label>Sale photo shows</label>
          <select value={photoSubject} onChange={(e) => setPhotoSubject(e.target.value as PhotoSubject)}>
            <option value="exact_plant">The exact plant being sold</option>
            <option value="representative_plant">A representative plant (not the exact one)</option>
          </select>

          <label>Pot size</label>
          <input type="text" value={potSize} onChange={(e) => setPotSize(e.target.value)} placeholder='e.g. 6" nursery pot' />

          <label>Approximate plant/vine size</label>
          <input type="text" value={plantSize} onChange={(e) => setPlantSize(e.target.value)} placeholder='e.g. 18" vine' />

          <label>
            <input
              type="checkbox"
              checked={rootedEstablished}
              onChange={(e) => setRootedEstablished(e.target.checked)}
            />{" "}
            Rooted / established
          </label>

          <label>Shipping presentation</label>
          <select
            value={shippingPresentation}
            onChange={(e) => setShippingPresentation(e.target.value as ShippingPresentation)}
          >
            <option value="ships_in_pot">Ships in the pot</option>
            <option value="prepared_other">Prepared another way</option>
          </select>
          {shippingPresentation === "prepared_other" && (
            <input
              type="text"
              value={shippingDetail}
              onChange={(e) => setShippingDetail(e.target.value)}
              placeholder="Describe how it ships"
            />
          )}

          <label>Condition / recent cutback notes (optional, exportable)</label>
          <textarea value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} rows={2} />
        </>
      )}

      {message && (
        <div className="flash error" role="alert" style={{ marginTop: 10 }}>
          {message}
        </div>
      )}

      <p style={{ marginTop: 12 }}>
        <button className="btn small" type="button" disabled={busy} onClick={submit}>
          {busy ? "Selecting…" : "Confirm selection"}
        </button>{" "}
        <button className="btn small secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </p>
    </div>
  );
}
