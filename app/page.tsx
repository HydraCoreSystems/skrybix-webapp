import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { OutgoingLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = getSupabaseServerClient();

  const [
    { count: motherCount },
    { count: cuttingCount },
    { count: soldPending },
    { count: outgoingCount },
    { count: printMothers },
    { count: printCuttings },
    { data: recentOutgoingRaw },
  ] = await Promise.all([
    supabase.from("mother_plants").select("*", { count: "exact", head: true }),
    supabase.from("cuttings").select("*", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("cuttings").select("*", { count: "exact", head: true }).is("archived_at", null).eq("sold", true),
    supabase.from("outgoing_log").select("*", { count: "exact", head: true }),
    supabase.from("mother_plants").select("*", { count: "exact", head: true }).eq("print_label", true),
    supabase.from("cuttings").select("*", { count: "exact", head: true }).eq("print_label", true),
    supabase.from("outgoing_log").select("*").order("id", { ascending: false }).limit(8),
  ]);

  const recentOutgoing = (recentOutgoingRaw ?? []) as OutgoingLogEntry[];

  return (
    <>
      <div className="stat-grid">
        <div className="stat">
          <div className="num">{motherCount ?? 0}</div>
          <div className="label">Mother Plants</div>
        </div>
        <div className="stat">
          <div className="num">{cuttingCount ?? 0}</div>
          <div className="label">Active Cuttings</div>
        </div>
        <div className="stat">
          <div className="num">{soldPending ?? 0}</div>
          <div className="label">Marked Sold (pending push)</div>
        </div>
        <div className="stat">
          <div className="num">{outgoingCount ?? 0}</div>
          <div className="label">Outgoing Log Entries</div>
        </div>
        <div className="stat">
          <div className="num">{printMothers ?? 0}</div>
          <div className="label">Mother Labels Queued</div>
        </div>
        <div className="stat">
          <div className="num">{printCuttings ?? 0}</div>
          <div className="label">Cutting Labels Queued</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Recent Outgoing Activity</h3>
        {recentOutgoing.length ? (
          <table>
            <thead>
              <tr>
                <th>Date Out</th>
                <th>Cutting ID</th>
                <th>Plant</th>
                <th>Qty</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {recentOutgoing.map((r) => (
                <tr key={r.id}>
                  <td>{r.date_out}</td>
                  <td>{r.cutting_id}</td>
                  <td>{r.full_display_name}</td>
                  <td>{r.qty}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No outgoing activity yet.</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Quick actions</h3>
        <Link className="btn" href="/mothers/new">
          + Add Mother Plant
        </Link>{" "}
        <Link className="btn" href="/cuttings/new">
          + Take Cuttings
        </Link>
      </div>
    </>
  );
}
