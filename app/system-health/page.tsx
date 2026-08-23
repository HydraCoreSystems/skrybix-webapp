import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { computeOperationsHealth, latestTimestamp } from "@/lib/operations-health";
import type { CommerceHandoffRecord } from "@/lib/commerce-health";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function when(value: string | null) {
  if (!value) return "No activity recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function recordHref(record: CommerceHandoffRecord) {
  return record.plantRecordType === "cutting"
    ? `/cuttings/${encodeURIComponent(record.sourceRecordId)}`
    : `/mothers/${encodeURIComponent(record.sourceRecordId)}`;
}

export default async function SystemHealthPage() {
  const supabase = getSupabaseServerClient();
  const [mothersRes, cuttingsRes, outgoingRes, authRes] = await Promise.all([
    supabase.from("mother_plants").select("mother_id,print_label,label_last_printed_at,commerce_selected_at,commerce_acknowledged_at"),
    supabase.from("cuttings").select("cutting_id,sold,print_label,archived_at,label_last_printed_at,commerce_selected_at,commerce_acknowledged_at"),
    supabase.from("outgoing_log").select("cutting_id,created_at,date_out"),
    supabase.from("site_auth").select("id").eq("id", 1).maybeSingle(),
  ]);
  const failures = [["mother plants", mothersRes.error], ["cuttings", cuttingsRes.error], ["outgoing history", outgoingRes.error], ["site access configuration", authRes.error]].filter(([, error]) => error);
  if (failures.length) {
    const detail = failures.map(([label, error]) => `${label}: ${(error as { message: string }).message}`).join("; ");
    throw new Error(`System Health could not verify the database: ${detail}`);
  }
  if (!authRes.data) throw new Error("System Health could not verify the site password record.");

  const mothers = mothersRes.data ?? [];
  const cuttings = cuttingsRes.data ?? [];
  const outgoing = outgoingRes.data ?? [];
  const commerceRecords: CommerceHandoffRecord[] = [
    ...mothers.map((row) => ({ sourceRecordId: row.mother_id, plantRecordType: "mother" as const, commerceSelectedAt: row.commerce_selected_at, commerceAcknowledgedAt: row.commerce_acknowledged_at })),
    ...cuttings.map((row) => ({ sourceRecordId: row.cutting_id, plantRecordType: "cutting" as const, commerceSelectedAt: row.commerce_selected_at, commerceAcknowledgedAt: row.commerce_acknowledged_at })),
  ];
  const health = computeOperationsHealth({
    commerceRecords,
    soldActiveCuttingIds: cuttings.filter((row) => row.sold && !row.archived_at).map((row) => row.cutting_id),
    archivedCuttingIds: cuttings.filter((row) => row.archived_at).map((row) => row.cutting_id),
    outgoingCuttingIds: outgoing.map((row) => row.cutting_id),
  });
  const queuedMothers = mothers.filter((row) => row.print_label);
  const queuedCuttings = cuttings.filter((row) => row.print_label);
  const lastPrint = latestTimestamp([...mothers.map((row) => row.label_last_printed_at), ...cuttings.map((row) => row.label_last_printed_at)]);
  const lastAcknowledgement = latestTimestamp(commerceRecords.map((row) => row.commerceAcknowledgedAt));
  const lastOutgoing = latestTimestamp(outgoing.map((row) => row.created_at || row.date_out));

  return <div className="operations-health visual-reference-page">
    <section className="card operations-hero"><div><p className="eyebrow">Owner operations</p><h1>System Health</h1><p>Live, read-only checks against the authoritative Skrybix database. Normal work queues are separated from conditions needing attention.</p></div><span className={`health-verdict ${health.integrityIssueCount ? "danger" : health.attentionCount ? "attention" : "healthy"}`}>{health.integrityIssueCount ? "Integrity attention required" : health.attentionCount ? `${health.attentionCount} item${health.attentionCount === 1 ? "" : "s"} need review` : "Operational checks clear"}</span></section>

    <div className="health-check-grid">
      <section className="card health-check"><p className="eyebrow">Database</p><h3>Connected now</h3><p>Mother plants, cuttings, outgoing history, and site-access configuration all responded successfully for this page load.</p></section>
      <section className="card health-check"><p className="eyebrow">Labels</p><h3>{queuedMothers.length + queuedCuttings.length} queued</h3><p>{queuedMothers.length} mother and {queuedCuttings.length} cutting labels. Last confirmed print: {when(lastPrint)}.</p><div className="actions"><Link className="btn small secondary" href="/labels/mothers">Mother labels</Link><Link className="btn small secondary" href="/labels/cuttings">Cutting labels</Link></div></section>
      <section className="card health-check"><p className="eyebrow">GM Commerce</p><h3>{health.commerce.waitingCount} waiting</h3><p>{health.commerce.waitingLongCount} have waited 48 hours or longer. Last acknowledgement: {when(lastAcknowledgement)}.</p><Link className="btn small secondary" href="https://gm-commerce-ten.vercel.app/products" target="_blank" rel="noreferrer">Open GM Commerce</Link></section>
      <section className="card health-check"><p className="eyebrow">Outgoing history</p><h3>{outgoing.length} records</h3><p>Last recorded physical disposition: {when(lastOutgoing)}.</p><Link className="btn small secondary" href="/outgoing">Open Outgoing Log</Link></section>
    </div>

    <section className="card"><div className="page-header"><div><p className="eyebrow">Reviewed work</p><h3>Needs your attention</h3></div><span className="status-pill queued">{health.attentionCount}</span></div>
      {!health.attentionCount ? <div className="worklist-empty"><strong>No operational attention is required.</strong><p>Queued labels remain normal work and are listed above.</p></div> : <div className="health-attention-list">
        {health.soldAwaitingDisposition.map((id) => <article key={`sold-${id}`}><div><strong>Sold cutting still in active inventory</strong><p>Review its disposition and record it as outgoing when appropriate.</p></div><Link className="btn small secondary" href={`/cuttings/${encodeURIComponent(id)}`}>{id}</Link></article>)}
        {health.commerce.waitingLongRecords.map((record) => <article key={`commerce-${record.plantRecordType}-${record.sourceRecordId}`}><div><strong>GM Commerce handoff has waited 48+ hours</strong><p>Selected {when(record.commerceSelectedAt)}; no acknowledgement is recorded.</p></div><Link className="btn small secondary" href={recordHref(record)}>{record.sourceRecordId}</Link></article>)}
        {health.archivedWithoutOutgoing.map((id) => <article className="danger" key={`archive-${id}`}><div><strong>Archived cutting has no outgoing record</strong><p>The inventory and permanent history disagree. Inspect this cutting before changing data.</p></div><Link className="btn small secondary" href={`/cuttings/${encodeURIComponent(id)}`}>{id}</Link></article>)}
        {health.outgoingWithoutArchive.map((id) => <article className="danger" key={`outgoing-${id}`}><div><strong>Outgoing record exists for an active cutting</strong><p>The permanent history says it left, but active inventory does not. Inspect this cutting before changing data.</p></div><Link className="btn small secondary" href={`/cuttings/${encodeURIComponent(id)}`}>{id}</Link></article>)}
      </div>}
    </section>

    <section className="card"><p className="eyebrow">Scope boundary</p><h3>What this page can—and cannot—prove</h3><p className="muted">It verifies database access during this request and derives states from stored Skrybix records. It does not claim continuous uptime, inspect Vercel infrastructure, or invent an error log that does not exist.</p></section>
  </div>;
}
