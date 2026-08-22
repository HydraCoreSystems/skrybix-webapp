import Link from "next/link";
import { CommerceSkuSelectionForm } from "@/components/CommerceSkuSelectionForm";
import { getCommerceHandoffState } from "@/lib/commerce-export";
import { LOCATIONS } from "@/lib/locations";
import { getSupabaseServerClient } from "@/lib/supabase";
import { toggleMotherField } from "./actions";
import type { MotherPlant } from "@/lib/types";

const PAGE_SIZE = 40;
const FILTERS = ["all", "labels", "commerce-ready", "commerce-waiting", "sold"] as const;
type MotherFilter = (typeof FILTERS)[number];
function filterValue(value?: string): MotherFilter { return FILTERS.includes(value as MotherFilter) ? value as MotherFilter : "all"; }
function cleanSearch(value?: string) { return (value ?? "").trim().replace(/[,%()]/g, " ").replace(/\s+/g, " "); }
function hrefFor(page: number, q: string, status: MotherFilter, location: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  if (location) params.set("location", location);
  if (page > 1) params.set("page", String(page));
  return `/mothers${params.size ? `?${params}` : ""}`;
}
function printedLabel(mother: MotherPlant) {
  if (!mother.label_print_count) return null;
  if (!mother.label_last_printed_at) return `Printed ${mother.label_print_count}×`;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(mother.label_last_printed_at));
  return `Printed ${when} · ${mother.label_print_count}×`;
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function MothersPage({ searchParams }: { searchParams: { success?: string; error?: string; q?: string; status?: string; location?: string; page?: string } }) {
  const supabase = getSupabaseServerClient();
  const q = cleanSearch(searchParams.q);
  const status = filterValue(searchParams.status);
  const location = LOCATIONS.includes(searchParams.location as (typeof LOCATIONS)[number]) ? searchParams.location! : "";
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  let query = supabase.from("mother_plants").select("*", { count: "exact" }).order("display_name").order("mother_id");
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`mother_id.ilike.${pattern},display_name.ilike.${pattern},species.ilike.${pattern},cultivar.ilike.${pattern},botanical_line1.ilike.${pattern},botanical_line2.ilike.${pattern}`);
  }
  if (location) query = query.eq("location", location);
  if (status === "labels") query = query.eq("print_label", true);
  if (status === "commerce-ready") query = query.is("commerce_selected_at", null);
  if (status === "commerce-waiting") query = query.not("commerce_selected_at", "is", null).is("commerce_acknowledged_at", null);
  if (status === "sold") query = query.eq("sold", true);
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`Unable to load mother plants: ${error.message}`);
  const rows = (data ?? []) as MotherPlant[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <div className="card">
    {searchParams.success && <div className="flash success">{searchParams.success}</div>}
    {searchParams.error && <div className="flash error">{searchParams.error}</div>}
    <div className="page-header"><div><p className="eyebrow">Living collection</p><h3>Mother Plants</h3></div><div className="actions"><Link className="btn" href="/mothers/new">+ Add Mother Plant</Link><Link className="btn secondary" href="/labels/mothers">View queued labels</Link></div></div>
    <form className="worklist-filters mother-filters" method="get">
      <label><span>Find mother plants</span><input type="search" name="q" defaultValue={q} placeholder="ID, name, species, or cultivar…" /></label>
      <label><span>Work queue</span><select name="status" defaultValue={status}><option value="all">All mother plants</option><option value="labels">Labels queued</option><option value="commerce-ready">Ready for GM Commerce</option><option value="commerce-waiting">Waiting on GM Commerce</option><option value="sold">Marked sold</option></select></label>
      <label><span>Location</span><select name="location" defaultValue={location}><option value="">Every location</option>{LOCATIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button className="btn" type="submit">Apply filters</button>
      {(q || status !== "all" || location) && <Link className="btn secondary" href="/mothers">Clear</Link>}
    </form>
    <p className="worklist-result-count">{total === 0 ? "No mother plants" : `${from + 1}–${Math.min(from + PAGE_SIZE, total)} of ${total}`} shown</p>
    {rows.length === 0 ? <div className="worklist-empty"><strong>No mother plants match this work queue.</strong><p>Clear the filters or choose another queue.</p></div> : <div className="mother-worklist">{rows.map((mother) => {
      const commerce = getCommerceHandoffState(mother);
      return <article className="mother-worklist-card" key={mother.mother_id}>
        <div className="mother-identity"><div><strong>{mother.display_name}</strong><code>{mother.mother_id}</code></div><span className={`status-pill ${mother.sold ? "queued" : "commerce-acknowledged"}`}>{mother.sold ? "Marked sold" : "In collection"}</span></div>
        <div className="mother-facts"><span><small>Location</small>{mother.location || "Not assigned"}</span><span><small>Botanical label</small>{[mother.botanical_line1, mother.botanical_line2].filter(Boolean).join(" · ") || "Not recorded"}</span></div>
        <div className="mother-status-row"><div><span className={`status-pill ${mother.print_label ? "queued" : mother.label_print_count ? "reprintable" : "commerce-selectable"}`}>{mother.print_label ? "Label queued" : mother.label_print_count ? "Reprint available" : "Label not printed"}</span>{printedLabel(mother) && <small>{printedLabel(mother)}</small>}</div><span className={`status-pill commerce-${commerce}`}>{commerce === "acknowledged" ? "GM Commerce received" : commerce === "selected" ? "Waiting on GM Commerce" : "Not sent to commerce"}</span></div>
        <div className="mother-card-actions"><Link className="btn small" href={`/cuttings/new?mother=${encodeURIComponent(mother.mother_id)}`}>Take cuttings</Link><Link className="btn small secondary" href={`/mothers/${encodeURIComponent(mother.mother_id)}/edit`}>Edit</Link><form action={toggleMotherField.bind(null, mother.mother_id, "print_label", !mother.print_label)}><button className="btn small secondary" type="submit">{mother.print_label ? "Remove from print queue" : mother.label_print_count ? "Queue reprint" : "Queue label"}</button></form><form action={toggleMotherField.bind(null, mother.mother_id, "sold", !mother.sold)}><button className="btn small secondary" type="submit">{mother.sold ? "Restore active" : "Mark sold"}</button></form><Link className="btn small secondary" href={`/plant/${encodeURIComponent(mother.mother_id)}`} target="_blank">Public page</Link></div>
        <details className="mother-commerce"><summary>{commerce === "unselected" ? "Sell whole mother plant through GM Commerce" : "GM Commerce handoff details"}</summary><CommerceSkuSelectionForm recordId={mother.mother_id} kind="mother" initialState={commerce} /></details>
      </article>;
    })}</div>}
    {totalPages > 1 && <nav className="pagination" aria-label="Mother plant pages">{page > 1 ? <Link className="btn small secondary" href={hrefFor(page - 1, q, status, location)}>← Previous</Link> : <span />}<span>Page {page} of {totalPages}</span>{page < totalPages ? <Link className="btn small secondary" href={hrefFor(page + 1, q, status, location)}>Next →</Link> : <span />}</nav>}
  </div>;
}
