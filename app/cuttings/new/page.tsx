import { getSupabaseServerClient } from "@/lib/supabase";
import { createCuttings } from "../actions";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewCuttingPage({ searchParams }: { searchParams: { error?: string; mother?: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: mothersRaw, error: mothersError } = await supabase
    .from("mother_plants")
    .select("mother_id, display_name")
    .order("mother_id");
  // A failed query here previously rendered an empty (but "required") mother
  // dropdown -- believable as "no mother plants exist yet," not as a DB
  // outage, and it silently blocks the whole take-cuttings workflow.
  if (mothersError) {
    throw new Error(`Unable to load mother plants: ${mothersError.message}`);
  }
  const mothers = (mothersRaw ?? []) as Pick<MotherPlant, "mother_id" | "display_name">[];

  return (
    <div className="card record-form-page">
      <p className="eyebrow">Propagation record</p><h1>Take Cuttings</h1>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Generates unique Cutting IDs the same way the Sheet did (Mother_ID-C01, -C02, ...) using a persistent,
        never-reused counter — no row-scanning fragility.
      </p>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={createCuttings}>
        <label>Mother Plant</label>
        <select name="mother_id" required defaultValue={searchParams.mother}>
          {mothers.map((m) => (
            <option key={m.mother_id} value={m.mother_id}>
              {m.mother_id} — {m.display_name}
            </option>
          ))}
        </select>

        <label>Number of new cuttings</label>
        <input type="number" name="num_cuts" min={1} defaultValue={1} required />

        <label>Date taken</label>
        <input type="date" name="date_taken" />

        <label className="creation-option">
          <input type="checkbox" name="queue_labels" value="yes" defaultChecked />
          <span>
            <strong>Queue labels for this batch</strong>
            <small>Recommended. You can review the new IDs before opening the print queue.</small>
          </span>
        </label>

        <p>
          <button className="btn warm" type="submit">
            Create and review batch
          </button>
        </p>
      </form>
    </div>
  );
}
