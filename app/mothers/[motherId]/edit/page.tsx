import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { updateMother } from "../../actions";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditMotherPage({
  params,
  searchParams,
}: {
  params: { motherId: string };
  searchParams: { error?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data: motherRaw } = await supabase
    .from("mother_plants")
    .select("*")
    .eq("mother_id", params.motherId)
    .maybeSingle();

  const mother = motherRaw as MotherPlant | null;
  if (!mother) notFound();

  const boundUpdate = updateMother.bind(null, mother.mother_id);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Edit Mother Plant</h3>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={boundUpdate}>
        <label>Mother ID (cannot be changed)</label>
        <input type="text" value={mother.mother_id} disabled />

        <label>Display Name</label>
        <input type="text" name="display_name" defaultValue={mother.display_name} required />

        <label>Location</label>
        <input type="text" name="location" defaultValue={mother.location ?? ""} />

        <label>Botanical Line 1 (label)</label>
        <input type="text" name="botanical_line1" defaultValue={mother.botanical_line1 ?? ""} />

        <label>Botanical Line 2 (label)</label>
        <input type="text" name="botanical_line2" defaultValue={mother.botanical_line2 ?? ""} />

        <p>
          <button className="btn" type="submit">
            Save
          </button>{" "}
          <a className="btn secondary" href="/mothers">
            Cancel
          </a>
        </p>
      </form>
    </div>
  );
}
