import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { computeCommerceHandoffHealth, type CommerceHandoffRecord } from "@/lib/commerce-health";
import type { OutgoingLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = getSupabaseServerClient();

  const [
    motherCountRes,
    cuttingCountRes,
    soldPendingRes,
    outgoingCountRes,
    printMothersRes,
    printCuttingsRes,
    recentOutgoingRes,
    commerceCuttingsRes,
    commerceMothersRes,
  ] = await Promise.all([
    supabase.from("mother_plants").select("*", { count: "exact", head: true }),
    supabase.from("cuttings").select("*", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("cuttings").select("*", { count: "exact", head: true }).is("archived_at", null).eq("sold", true),
    supabase.from("outgoing_log").select("*", { count: "exact", head: true }),
    supabase.from("mother_plants").select("*", { count: "exact", head: true }).eq("print_label", true),
    supabase.from("cuttings").select("*", { count: "exact", head: true }).eq("print_label", true),
    supabase.from("outgoing_log").select("*").order("id", { ascending: false }).limit(8),
    // GM Commerce handoff health (owner-visible only -- see
    // lib/commerce-health.ts). Reads the same two timestamp columns the
    // existing narrow export API already reads; no new external surface.
    supabase.from("cuttings").select("cutting_id, commerce_selected_at, commerce_acknowledged_at").not("commerce_selected_at", "is", null),
    supabase.from("mother_plants").select("mother_id, commerce_selected_at, commerce_acknowledged_at").not("commerce_selected_at", "is", null),
  ]);

  // Every dashboard number must be either real or a visible failure -- never
  // a believable-looking 0/empty state that silently hides a DB outage. A
  // null count from a failed query previously rendered as "0", which is
  // indistinguishable from genuinely having zero records.
  const failures = [
    ["mother plant count", motherCountRes.error],
    ["active cutting count", cuttingCountRes.error],
    ["sold-pending count", soldPendingRes.error],
    ["outgoing log count", outgoingCountRes.error],
    ["queued mother labels count", printMothersRes.error],
    ["queued cutting labels count", printCuttingsRes.error],
    ["recent outgoing activity", recentOutgoingRes.error],
    ["GM Commerce handoff (cuttings)", commerceCuttingsRes.error],
    ["GM Commerce handoff (mothers)", commerceMothersRes.error],
  ].filter(([, error]) => error);

  if (failures.length > 0) {
    const detail = failures.map(([label, error]) => `${label} (${(error as { message: string }).message})`).join("; ");
    throw new Error(`Dashboard could not load from the database: ${detail}`);
  }

  const { count: motherCount } = motherCountRes;
  const { count: cuttingCount } = cuttingCountRes;
  const { count: soldPending } = soldPendingRes;
  const { count: outgoingCount } = outgoingCountRes;
  const { count: printMothers } = printMothersRes;
  const { count: printCuttings } = printCuttingsRes;
  const recentOutgoing = (recentOutgoingRes.data ?? []) as OutgoingLogEntry[];

  const commerceRecords: CommerceHandoffRecord[] = [
    ...(commerceCuttingsRes.data ?? []).map((r) => ({
      sourceRecordId: r.cutting_id as string,
      plantRecordType: "cutting" as const,
      commerceSelectedAt: r.commerce_selected_at as string | null,
      commerceAcknowledgedAt: r.commerce_acknowledged_at as string | null,
    })),
    ...(commerceMothersRes.data ?? []).map((r) => ({
      sourceRecordId: r.mother_id as string,
      plantRecordType: "mother" as const,
      commerceSelectedAt: r.commerce_selected_at as string | null,
      commerceAcknowledgedAt: r.commerce_acknowledged_at as string | null,
    })),
  ];
  const commerceHealth = computeCommerceHandoffHealth(commerceRecords);

  return (
    <>
      <div className="stat-grid">
        <Link className="stat stat-link" href="/mothers">
          <div className="num">{motherCount ?? 0}</div>
          <div className="label">Mother Plants</div>
        </Link>
        <Link className="stat stat-link" href="/cuttings">
          <div className="num">{cuttingCount ?? 0}</div>
          <div className="label">Active Cuttings</div>
        </Link>
        <Link className="stat stat-link" href="/cuttings?status=sold">
          <div className="num">{soldPending ?? 0}</div>
          <div className="label">Marked Sold (needs review)</div>
        </Link>
        <Link className="stat stat-link" href="/outgoing">
          <div className="num">{outgoingCount ?? 0}</div>
          <div className="label">Outgoing Log Entries</div>
        </Link>
        <Link className="stat stat-link" href="/labels/mothers">
          <div className="num">{printMothers ?? 0}</div>
          <div className="label">Mother Labels Queued</div>
        </Link>
        <Link className="stat stat-link" href="/cuttings?status=labels">
          <div className="num">{printCuttings ?? 0}</div>
          <div className="label">Cutting Labels Queued</div>
        </Link>
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
                  <td><Link href={`/outgoing?q=${encodeURIComponent(r.cutting_id)}`}>{r.cutting_id}</Link></td>
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
        <div className="page-header"><h3 style={{ marginTop: 0 }}>GM Commerce handoff health</h3><Link className="btn small secondary" href="/system-health">Open System Health</Link></div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          Owner-visible only -- reads the same selection/acknowledgement timestamps the existing narrow
          authenticated export API already uses. No new access is granted to GM Commerce by this view.
        </p>
        <div className="stat-grid">
          <Link className="stat stat-link" href="/cuttings?status=commerce-waiting">
            <div className="num">{commerceHealth.waitingCount}</div>
            <div className="label">Selected, waiting on GM Commerce</div>
          </Link>
          <Link className="stat stat-link" href="/cuttings?status=commerce-waiting">
            <div className="num">{commerceHealth.waitingLongCount}</div>
            <div className="label">Waiting unusually long (48h+)</div>
          </Link>
          <div className="stat">
            <div className="num">{commerceHealth.acknowledgedCount}</div>
            <div className="label">Acknowledged / received (all time)</div>
          </div>
        </div>
        {commerceHealth.waitingLongRecords.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Record</th>
                <th>Type</th>
                <th>Selected</th>
              </tr>
            </thead>
            <tbody>
              {commerceHealth.waitingLongRecords.map((r) => (
                <tr key={`${r.plantRecordType}-${r.sourceRecordId}`}>
                  <td><Link href={r.plantRecordType === "cutting" ? `/cuttings/${encodeURIComponent(r.sourceRecordId)}` : `/mothers/${encodeURIComponent(r.sourceRecordId)}`}>{r.sourceRecordId}</Link></td>
                  <td>{r.plantRecordType}</td>
                  <td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(r.commerceSelectedAt as string))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 0 }}>System Health adds the operational checks this dashboard can derive honestly, while keeping unprovable infrastructure claims out of the UI.</p>
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
