"use client";

import { useState } from "react";
import { selectCuttingForCommerce } from "@/app/cuttings/actions";
import { selectMotherForCommerce } from "@/app/mothers/actions";
import type { CommerceHandoffState } from "@/lib/commerce-export";

export function CommerceSelectionControl({
  recordId,
  kind,
  initialState,
}: {
  recordId: string;
  kind: "cutting" | "mother";
  initialState: CommerceHandoffState;
}) {
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  if (state === "acknowledged") {
    return <span>Received by GM Commerce</span>;
  }

  if (state === "selected") {
    return <span>Selected for GM Commerce</span>;
  }

  async function select() {
    setIsSelecting(true);
    const result = kind === "cutting" ? await selectCuttingForCommerce(recordId) : await selectMotherForCommerce(recordId);
    setIsSelecting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setState(result.state);
  }

  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={false}
          disabled={isSelecting}
          onChange={(event) => {
            if (event.target.checked) {
              void select();
            }
          }}
        />{" "}
        {isSelecting ? "Selecting..." : "Select for GM Commerce"}
      </label>
      {message && (
        <div className="flash error" role="alert">
          {message}
        </div>
      )}
    </>
  );
}
