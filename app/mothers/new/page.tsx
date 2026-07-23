import { createMother } from "../actions";
import { getSupabaseServerClient } from "@/lib/supabase";
import MotherNamingFields from "@/components/MotherNamingFields";

export const dynamic = "force-dynamic";

export default async function NewMotherPage({ searchParams }: { searchParams: { error?: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: speciesRows } = await supabase.from("hoya_species").select("species").order("species");
  const speciesOptions = (speciesRows ?? []).map((r) => r.species as string);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Add Mother Plant</h3>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={createMother}>
        <label>Mother ID</label>
        <input type="text" name="mother_id" required placeholder="e.g. M014" />

        <label>Display Name</label>
        <input type="text" name="display_name" required />

        <label>Location</label>
        <input type="text" name="location" />

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
