import { createMother } from "../actions";

export const dynamic = "force-dynamic";

export default function NewMotherPage({ searchParams }: { searchParams: { error?: string } }) {
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

        <label>Botanical Line 1 (label)</label>
        <input type="text" name="botanical_line1" />

        <label>Botanical Line 2 (label)</label>
        <input type="text" name="botanical_line2" />

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
