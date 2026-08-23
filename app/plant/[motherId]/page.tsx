import { notFound } from "next/navigation";
import { routeRecordId } from "@/lib/route-record-id";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { MotherPlant, Cutting } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicPlantPage({ params }: { params: { motherId: string } }) {
  const motherId = routeRecordId(params.motherId);
  const supabase = getSupabaseServerClient();
  const { data: motherRaw, error: motherError } = await supabase
    .from("mother_plants")
    .select("*")
    .eq("mother_id", motherId)
    .maybeSingle();

  // A real DB error must not look identical to "this plant doesn't exist" --
  // a transient Supabase hiccup on a customer's scanned QR code should show
  // a visible failure, not a dead-link-looking 404.
  if (motherError) {
    throw new Error(`Unable to load this plant: ${motherError.message}`);
  }

  const mother = motherRaw as MotherPlant | null;
  if (!mother) notFound();

  await supabase.rpc("increment_mother_scan_count", { p_mother_id: motherId });

  const { data: cuttingsRaw, error: cuttingsError } = await supabase
    .from("cuttings")
    .select("*")
    .eq("mother_id", motherId)
    .order("cutting_id");
  if (cuttingsError) {
    throw new Error(`Unable to load cuttings for this plant: ${cuttingsError.message}`);
  }
  const cuttings = (cuttingsRaw ?? []) as Cutting[];

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{mother.display_name}</h3>
      <p>
        <em>{mother.botanical_line1}</em>
        {mother.botanical_line2 ? ` — ${mother.botanical_line2}` : ""}
      </p>
      <p>Location: {mother.location}</p>
      <h4>Cuttings from this mother</h4>
      <table>
        <thead>
          <tr>
            <th>Cutting ID</th>
            <th>Date Taken</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {cuttings.map((c) => (
            <tr key={c.cutting_id}>
              <td>{c.cutting_id}</td>
              <td>{c.date_taken}</td>
              <td>{c.archived_at ? "Sold" : c.sold ? "Marked sold" : "Active"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
