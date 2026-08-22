import { getSupabaseServerClient } from "@/lib/supabase";
import { matchesQuery } from "@/lib/search";
import SearchBox from "@/components/SearchBox";
import type { OutgoingLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OutgoingPage({ searchParams }: { searchParams: { q?: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw, error: rowsError } = await supabase
    .from("outgoing_log")
    .select("*")
    .order("id", { ascending: false });
  if (rowsError) {
    throw new Error(`Unable to load the outgoing log: ${rowsError.message}`);
  }
  const allRows = (rowsRaw ?? []) as OutgoingLogEntry[];
  const q = searchParams.q ?? "";
  const rows = allRows.filter((r) =>
    matchesQuery([r.cutting_id, r.full_display_name, r.reason, r.selling_platform, r.notes], q)
  );

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Outgoing Log</h3>
      <SearchBox placeholder="Search by Cutting ID, plant, reason…" defaultValue={q} />
      {q && (
        <p className="search-result-count">
          {rows.length} of {allRows.length} entries match "{q}"
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Date Out</th>
            <th>Cutting ID</th>
            <th>Plant</th>
            <th>Qty</th>
            <th>Reason</th>
            <th>Platform</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.date_out}</td>
              <td>{r.cutting_id}</td>
              <td>{r.full_display_name}</td>
              <td>{r.qty}</td>
              <td>{r.reason}</td>
              <td>{r.selling_platform}</td>
              <td>{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
