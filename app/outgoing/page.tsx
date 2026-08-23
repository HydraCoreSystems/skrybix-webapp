import Link from "next/link";
import { OUTGOING_REASONS } from "@/lib/cuttings-batch";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { OutgoingLogEntry } from "@/lib/types";

const PAGE_SIZE = 50;
function safeText(value?: string) { return (value ?? "").trim().replace(/[,%()]/g, " ").replace(/\s+/g, " "); }
function validDate(value?: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value! : ""; }
function pageHref(page: number, q: string, reason: string, from: string, to: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (reason) params.set("reason", reason);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (page > 1) params.set("page", String(page));
  return `/outgoing${params.size ? `?${params}` : ""}`;
}
function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function OutgoingPage({ searchParams }: { searchParams: { q?: string; reason?: string; from?: string; to?: string; page?: string } }) {
  const supabase = getSupabaseServerClient();
  const q = safeText(searchParams.q);
  const reason = OUTGOING_REASONS.includes(searchParams.reason as never) ? searchParams.reason! : "";
  const dateFrom = validDate(searchParams.from);
  const dateTo = validDate(searchParams.to);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  let query = supabase.from("outgoing_log").select("*", { count: "exact" }).order("date_out", { ascending: false }).order("id", { ascending: false });
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`cutting_id.ilike.${pattern},full_display_name.ilike.${pattern},selling_platform.ilike.${pattern},notes.ilike.${pattern}`);
  }
  if (reason) query = query.eq("reason", reason);
  if (dateFrom) query = query.gte("date_out", dateFrom);
  if (dateTo) query = query.lte("date_out", dateTo);
  const fromRow = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(fromRow, fromRow + PAGE_SIZE - 1);
  if (error) throw new Error(`Unable to load the outgoing log: ${error.message}`);
  const rows = (data ?? []) as OutgoingLogEntry[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || reason || dateFrom || dateTo);

  return <div className="card workbench-page outgoing-workbench">
    <div className="page-header workbench-heading"><div><p className="eyebrow">Permanent inventory history</p><h1>Outgoing Log</h1><p>A durable record of every cutting that left active inventory and why.</p></div><Link className="btn secondary" href="/cuttings">Return to active cuttings</Link></div>
    <div className="outgoing-boundary"><strong>Skrybix records physical disposition.</strong><span>For a sale's price, marketplace, customer, or order details, use the Commercial Ledger in GM Commerce.</span></div>
    <form className="worklist-filters outgoing-filters" method="get">
      <label><span>Find outgoing plants</span><input type="search" name="q" defaultValue={q} placeholder="Cutting ID, plant, platform, or notes…" /></label>
      <label><span>Reason</span><select name="reason" defaultValue={reason}><option value="">Every reason</option>{OUTGOING_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>From</span><input type="date" name="from" defaultValue={dateFrom} /></label>
      <label><span>Through</span><input type="date" name="to" defaultValue={dateTo} /></label>
      <button className="btn" type="submit">Apply filters</button>
      {filtered && <Link className="btn secondary" href="/outgoing">Clear</Link>}
    </form>
    <p className="worklist-result-count">{total === 0 ? "No outgoing records" : `${fromRow + 1}–${Math.min(fromRow + PAGE_SIZE, total)} of ${total}`} shown</p>
    {rows.length === 0 ? <div className="worklist-empty"><strong>No outgoing records match these filters.</strong><p>Clear the filters or widen the date range.</p></div> : <div className="outgoing-history-list">{rows.map((row) => <article className="outgoing-history-card" key={row.id}>
      <div className="outgoing-history-heading"><div><strong>{row.full_display_name || "Unnamed plant"}</strong><code>{row.cutting_id}</code></div><div><span className="status-pill queued">{row.reason || "Unspecified"}</span><time>{displayDate(row.date_out)}</time></div></div>
      <div className="outgoing-history-facts"><span><small>Quantity</small>{row.qty}</span><span><small>Destination / platform</small>{row.selling_platform || "Not recorded"}</span><span><small>Notes</small>{row.notes || "No notes recorded"}</span></div>
    </article>)}</div>}
    {totalPages > 1 && <nav className="pagination" aria-label="Outgoing log pages">{page > 1 ? <Link className="btn small secondary" href={pageHref(page - 1, q, reason, dateFrom, dateTo)}>← Previous</Link> : <span />}<span>Page {page} of {totalPages}</span>{page < totalPages ? <Link className="btn small secondary" href={pageHref(page + 1, q, reason, dateFrom, dateTo)}>Next →</Link> : <span />}</nav>}
  </div>;
}
