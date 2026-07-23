import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { MotherPlant, Cutting } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicPlantPage({ params }: { params: { motherId: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: motherRaw } = await supabase
    .from("mother_plants")
    .select("*")
    .eq("mother_id", params.motherId)
    .maybeSingle();

  const mother = motherRaw as MotherPlant | null;
  if (!mother) notFound();

  const { data: cuttingsRaw } = await supabase
    .from("cuttings")
    .select("*")
    .eq("mother_id", params.motherId)
    .order("cutting_id");
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
