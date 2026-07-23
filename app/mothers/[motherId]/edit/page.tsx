import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { updateMother } from "../../actions";
import MotherNamingFields from "@/components/MotherNamingFields";
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

  const { data: speciesRows } = await supabase.from("hoya_species").select("species").order("species");
  const speciesOptions = (speciesRows ?? []).map((r) => r.species as string);

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

        <MotherNamingFields
          defaultValues={{
            genus: mother.genus,
            species: mother.species,
            form_code: mother.form_code,
            cultivar: mother.cultivar,
            name_type: mother.name_type,
            natural_cultivar: mother.natural_cultivar,
            botanical_line1: mother.botanical_line1,
            botanical_line2: mother.botanical_line2,
          }}
          speciesOptions={speciesOptions}
        />

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
