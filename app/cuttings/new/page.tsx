import { getSupabaseServerClient } from "@/lib/supabase";
import { createCuttings } from "../actions";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewCuttingPage({ searchParams }: { searchParams: { error?: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: mothersRaw } = await supabase.from("mother_plants").select("mother_id, display_name").order("mother_id");
  const mothers = (mothersRaw ?? []) as Pick<MotherPlant, "mother_id" | "display_name">[];

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Take Cuttings</h3>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Generates unique Cutting IDs the same way the Sheet did (Mother_ID-C01, -C02, ...) using a persistent,
        never-reused counter — no row-scanning fragility.
      </p>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={createCuttings}>
        <label>Mother Plant</label>
        <select name="mother_id" required>
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

        <p>
          <button className="btn" type="submit">
            Create Cuttings
          </button>
        </p>
      </form>
    </div>
  );
}
