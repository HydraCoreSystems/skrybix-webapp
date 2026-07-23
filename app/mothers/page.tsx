import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { toggleMotherPrint } from "./actions";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MothersPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("mother_plants").select("*").order("mother_id");
  const rows = (rowsRaw ?? []) as MotherPlant[];

  return (
    <div className="card">
      {searchParams.success && <div className="flash success">{searchParams.success}</div>}
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <h3 style={{ marginTop: 0 }}>Mother Plants</h3>
      <Link className="btn" href="/mothers/new">
        + Add Mother Plant
      </Link>{" "}
      <Link className="btn secondary" href="/api/labels/mothers.csv">
        Export queued → CSV
      </Link>{" "}
      <Link className="btn secondary" href="/labels/mothers">
        View queued labels
      </Link>
      <table>
        <thead>
          <tr>
            <th>Mother ID</th>
            <th>Display Name</th>
            <th>Location</th>
            <th>Botanical</th>
            <th>Print?</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.mother_id}>
              <td>{m.mother_id}</td>
              <td>{m.display_name}</td>
              <td>{m.location}</td>
              <td>
                {m.botanical_line1}
                <br />
                <small>{m.botanical_line2}</small>
              </td>
              <td>
                <form action={toggleMotherPrint.bind(null, m.mother_id, !m.print_label)}>
                  <button className={`btn small ${m.print_label ? "" : "secondary"}`} type="submit">
                    {m.print_label ? "Queued ✓" : "Queue for print"}
                  </button>
                </form>
              </td>
              <td>
                <Link className="btn small secondary" href={`/mothers/${encodeURIComponent(m.mother_id)}/edit`}>
                  Edit
                </Link>{" "}
                <Link
                  className="btn small secondary"
                  href={`/plant/${encodeURIComponent(m.mother_id)}`}
                  target="_blank"
                >
                  View public page
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
