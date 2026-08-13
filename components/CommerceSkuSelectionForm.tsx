"use client";

import { useState } from "react";
import { selectCuttingForCommerce } from "@/app/cuttings/actions";
import { selectMotherForCommerce } from "@/app/mothers/actions";
import { createPlantCode } from "@/app/commerce/actions";
import type { CommerceHandoffState } from "@/lib/commerce-export";
import type { GenusCode, PlantCode, PhotoSubject, ShippingPresentation } from "@/lib/commerce-sku";

const NEW_CODE_VALUE = "__new__";

type Props = {
  kind: "cutting" | "mother";
  recordId: string;
  motherId?: string; // required when kind === "cutting"
  initialState: CommerceHandoffState;
  sku?: string | null;
  genusCodes: GenusCode[];
  plantCodes: PlantCode[];
};

export function CommerceSkuSelectionForm({ kind, recordId, motherId, initialState, sku, genusCodes, plantCodes }: Props) {
  const [state, setState] = useState(initialState);
  const [assignedSku, setAssignedSku] = useState(sku ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [genusCode, setGenusCode] = useState(genusCodes[0]?.code ?? "");
  const [plantCodeChoice, setPlantCodeChoice] = useState<string>("");
  const [newPlantCode, setNewPlantCode] = useState("");
  const [newPlantLabel, setNewPlantLabel] = useState("");

  // Mother-only required facts (design report §8 / CLAUDE.md decision
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
    return <span>Received by GM Commerce{assignedSku ? ` (${assignedSku})` : ""}</span>;
  }
  if (state === "selected") {
    return <span>Selected for GM Commerce{assignedSku ? ` (${assignedSku})` : ""}</span>;
  }

  const plantCodesForGenus = plantCodes.filter((p) => p.genus_code === genusCode);

  async function resolvePlantCode(): Promise<{ code: string; error?: string }> {
    if (plantCodeChoice === NEW_CODE_VALUE) {
      const code = newPlantCode.trim().toUpperCase();
      const label = newPlantLabel.trim();
      if (!/^[A-Z0-9]{3}$/.test(code)) {
        return { code: "", error: "Plant code must be exactly 3 uppercase letters/digits." };
      }
      if (!label) {
        return { code: "", error: "Describe what this new plant code identifies." };
      }
      const created = await createPlantCode(genusCode, code, label);
      if (!created.ok) {
        return { code: "", error: created.message };
      }
      return { code };
    }
    if (!plantCodeChoice) {
      return { code: "", error: "Pick or create a plant code first." };
    }
    return { code: plantCodeChoice };
  }

  async function submit() {
    setBusy(true);
    setMessage(null);

    const { code: plantCode, error: plantCodeError } = await resolvePlantCode();
    if (plantCodeError) {
      setBusy(false);
      setMessage(plantCodeError);
      return;
    }

    const result =
      kind === "cutting"
        ? await selectCuttingForCommerce(recordId, motherId ?? "", genusCode, plantCode)
        : await selectMotherForCommerce(recordId, genusCode, plantCode, {
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
    setAssignedSku(result.sku);
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
      <label>Genus</label>
      <select
        value={genusCode}
        onChange={(e) => {
          setGenusCode(e.target.value);
          setPlantCodeChoice("");
        }}
      >
        {genusCodes.map((g) => (
          <option key={g.code} value={g.code}>
            {g.code} — {g.genus_name}
          </option>
        ))}
      </select>

      <label>Plant code</label>
      <select value={plantCodeChoice} onChange={(e) => setPlantCodeChoice(e.target.value)}>
        <option value="">(choose)</option>
        {plantCodesForGenus.map((p) => (
          <option key={p.code} value={p.code}>
            {p.code} — {p.display_label}
          </option>
        ))}
        <option value={NEW_CODE_VALUE}>+ Add new plant code…</option>
      </select>

      {plantCodeChoice === NEW_CODE_VALUE && (
        <>
          <label>New 3-character code</label>
          <input
            type="text"
            value={newPlantCode}
            onChange={(e) => setNewPlantCode(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="e.g. KRQ"
          />
          <label>What identity is this code for?</label>
          <input
            type="text"
            value={newPlantLabel}
            onChange={(e) => setNewPlantLabel(e.target.value)}
            placeholder="e.g. Hoya krohniana"
          />
        </>
      )}

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
