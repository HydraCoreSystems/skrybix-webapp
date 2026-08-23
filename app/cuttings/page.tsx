import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import CuttingsBatchTable, { type CuttingsTableRow } from "@/components/CuttingsBatchTable";
import type { Cutting } from "@/lib/types";

const PAGE_SIZE = 50;
const CUTTING_FILTERS = ["all", "labels", "commerce-ready", "commerce-waiting", "sold"] as const;
type CuttingFilter = (typeof CUTTING_FILTERS)[number];

function normalizedFilter(value?: string): CuttingFilter {
  return CUTTING_FILTERS.includes(value as CuttingFilter) ? (value as CuttingFilter) : "all";
}

function safeSearch(value?: string) {
  return (value ?? "").trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ");
}

function pageHref(page: number, q: string, status: CuttingFilter) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  return `/cuttings${params.size ? `?${params}` : ""}`;
}

type CuttingRow = Cutting & { mother_plants: { display_name: string } | null };

function toTableRow(c: CuttingRow): CuttingsTableRow {
  return {
    cutting_id: c.cutting_id,
    motherDisplayName: c.mother_plants?.display_name ?? null,
    motherId: c.mother_id,
    dateTaken: c.date_taken,
    print_label: c.print_label,
    label_print_count: c.label_print_count,
    label_last_printed_at: c.label_last_printed_at,
    sold: c.sold,
    scan_count: c.scan_count,
    commerce_selected_at: c.commerce_selected_at,
    commerce_acknowledged_at: c.commerce_acknowledged_at,
  };
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function CuttingsPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; q?: string; status?: string; page?: string; batch?: string };
}) {
  const supabase = getSupabaseServerClient();
  const q = safeSearch(searchParams.q);
  const status = normalizedFilter(searchParams.status);
  const batchIds = Array.from(new Set((searchParams.batch ?? "").split(",").map((id) => id.trim()).filter(Boolean)));
  const requestedPage = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);

  let rowsQuery = supabase
    .from("cuttings")
    .select("*, mother_plants(display_name)", { count: "exact" })
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (batchIds.length > 0) {
    rowsQuery = rowsQuery.in("cutting_id", batchIds);
  } else {
    if (q) {
      const pattern = `%${q}%`;
      rowsQuery = rowsQuery.or(`cutting_id.ilike.${pattern},mother_id.ilike.${pattern},full_display_name.ilike.${pattern}`);
    }
    if (status === "labels") rowsQuery = rowsQuery.eq("print_label", true);
    if (status === "commerce-ready") rowsQuery = rowsQuery.is("commerce_selected_at", null);
    if (status === "commerce-waiting") {
      rowsQuery = rowsQuery.not("commerce_selected_at", "is", null).is("commerce_acknowledged_at", null);
    }
    if (status === "sold") rowsQuery = rowsQuery.eq("sold", true);
  }

  const page = batchIds.length > 0 ? 1 : requestedPage;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data: rowsRaw, error: rowsError, count } = await rowsQuery.range(from, to);
  if (rowsError) {
    throw new Error(`Unable to load cuttings: ${rowsError.message}`);
  }
  const rows = (rowsRaw ?? []) as CuttingRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="card workbench-page cuttings-workbench">
      {searchParams.success && <div className="flash success">{searchParams.success}</div>}
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <div className="page-header workbench-heading">
        <div><p className="eyebrow">Propagation inventory</p><h1>Cuttings</h1><p>Select once, then move a batch into labels, GM Commerce, or permanent outgoing history.</p></div>
        <div className="actions">
          <Link className="btn warm" href="/cuttings/new">
            + Take Cuttings
          </Link>
          <Link className="btn secondary" href="/labels/cuttings">
            View queued labels
          </Link>
        </div>
      </div>

      {batchIds.length > 0 ? (
        <div className="batch-review-banner">
          <div>
            <strong>New cutting batch</strong>
            <span>{rows.length} newly created cutting{rows.length === 1 ? "" : "s"} ready for review.</span>
          </div>
          <Link className="btn small secondary" href="/cuttings">Return to all cuttings</Link>
        </div>
      ) : (
        <form className="worklist-filters" method="get">
          <label>
            <span>Find cuttings</span>
            <input type="search" name="q" defaultValue={q} placeholder="ID, mother ID, or plant name…" />
          </label>
          <label>
            <span>Work queue</span>
            <select name="status" defaultValue={status}>
              <option value="all">All active cuttings</option>
              <option value="labels">Labels queued</option>
              <option value="commerce-ready">Ready for GM Commerce</option>
              <option value="commerce-waiting">Waiting on GM Commerce</option>
              <option value="sold">Marked sold</option>
            </select>
          </label>
          <button className="btn" type="submit">Apply filters</button>
          {(q || status !== "all") && <Link className="btn secondary" href="/cuttings">Clear</Link>}
        </form>
      )}

      <p className="worklist-result-count">
        {total === 0 ? "No cuttings" : `${from + 1}–${Math.min(to + 1, total)} of ${total}`} shown
      </p>

      <CuttingsBatchTable rows={rows.map(toTableRow)} />

      {batchIds.length === 0 && totalPages > 1 && (
        <nav className="pagination" aria-label="Cuttings pages">
          {page > 1 ? <Link className="btn small secondary" href={pageHref(page - 1, q, status)}>← Previous</Link> : <span />}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages ? <Link className="btn small secondary" href={pageHref(page + 1, q, status)}>Next →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
