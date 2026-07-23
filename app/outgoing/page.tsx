import { getSupabaseServerClient } from "@/lib/supabase";
import type { OutgoingLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OutgoingPage() {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("outgoing_log").select("*").order("id", { ascending: false });
  const rows = (rowsRaw ?? []) as OutgoingLogEntry[];

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Outgoing Log</h3>
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
