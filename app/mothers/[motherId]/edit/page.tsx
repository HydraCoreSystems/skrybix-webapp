import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { updateMother } from "../../actions";
import MotherNamingFields from "@/components/MotherNamingFields";
import LocationSelect from "@/components/LocationSelect";
import type { MotherPlant } from "@/lib/types";
import { routeRecordId } from "@/lib/route-record-id";

export const dynamic = "force-dynamic";

export default async function EditMotherPage({
  params,
  searchParams,
}: {
  params: { motherId: string };
  searchParams: { error?: string };
}) {
  const supabase = getSupabaseServerClient();
  const motherId = routeRecordId(params.motherId);
  const { data: motherRaw, error: motherError } = await supabase
    .from("mother_plants")
    .select("*")
    .eq("mother_id", motherId)
    .maybeSingle();

  // A real DB error must not look identical to "this mother plant doesn't
  // exist" -- editing a real record during a DB hiccup previously showed a
  // 404, indistinguishable from the record genuinely being gone.
  if (motherError) {
    throw new Error(`Unable to load mother plant ${motherId}: ${motherError.message}`);
  }

  const mother = motherRaw as MotherPlant | null;
  if (!mother) notFound();

  const { data: speciesRows, error: speciesError } = await supabase
    .from("hoya_species")
    .select("species")
    .order("species");
  if (speciesError) {
    throw new Error(`Unable to load the species list: ${speciesError.message}`);
  }
  const speciesOptions = (speciesRows ?? []).map((r) => r.species as string);

  const boundUpdate = updateMother.bind(null, mother.mother_id);

  return (
    <div className="card record-form-page">
      <p className="eyebrow">Collection record</p><h1>Edit Mother Plant</h1>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={boundUpdate}>
        <label>Mother ID (cannot be changed)</label>
        <input type="text" value={mother.mother_id} disabled />

        <label>Display Name (auto-composed from the naming fields below)</label>
        <input type="text" value={mother.display_name} disabled />

        <label>Location</label>
        <LocationSelect defaultValue={mother.location} />

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
          <button className="btn warm" type="submit">
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
