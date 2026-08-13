import { createMother } from "../actions";
import { getSupabaseServerClient } from "@/lib/supabase";
import MotherNamingFields from "@/components/MotherNamingFields";
import LocationSelect from "@/components/LocationSelect";

export const dynamic = "force-dynamic";

export default async function NewMotherPage({ searchParams }: { searchParams: { error?: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: speciesRows } = await supabase.from("hoya_species").select("species").order("species");
  const speciesOptions = (speciesRows ?? []).map((r) => r.species as string);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Add Mother Plant</h3>
      <p style={{ marginTop: 0 }}>
        Mother ID and Display Name are assigned automatically from the species (or, if unidentified, the
        cultivar/descriptor text below) once you save.
      </p>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={createMother}>
        <label>Location</label>
        <LocationSelect />

        <MotherNamingFields speciesOptions={speciesOptions} />

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
