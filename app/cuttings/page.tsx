import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { pushSoldToOutgoingLog } from "./actions";
import { matchesQuery } from "@/lib/search";
import SearchBox from "@/components/SearchBox";
import CuttingsBatchTable, { type CuttingsTableRow } from "@/components/CuttingsBatchTable";
import type { Cutting } from "@/lib/types";

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
  searchParams: { success?: string; error?: string; q?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw, error: rowsError } = await supabase
    .from("cuttings")
    .select("*, mother_plants(display_name)")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (rowsError) {
    throw new Error(`Unable to load cuttings: ${rowsError.message}`);
  }
  const allRows = (rowsRaw ?? []) as CuttingRow[];
  const q = searchParams.q ?? "";
  // "Visible" for the batch "select all visible" controls is exactly this
  // filtered subset (after search), never the whole database.
  const rows = allRows.filter((c) => matchesQuery([c.cutting_id, c.mother_id, c.mother_plants?.display_name], q));

  return (
    <div className="card">
      {searchParams.success && <div className="flash success">{searchParams.success}</div>}
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <div className="page-header">
        <h3>Cuttings</h3>
        <div className="actions">
          <Link className="btn" href="/cuttings/new">
            + Take Cuttings
          </Link>
          <Link className="btn secondary" href="/labels/cuttings">
            View queued labels
          </Link>
          <form className="inline" action={pushSoldToOutgoingLog}>
            <button className="btn secondary" type="submit">
              Push Sold → Outgoing Log
            </button>
          </form>
        </div>
      </div>
      <SearchBox placeholder="Search by Cutting ID or mother…" defaultValue={q} />
      {q && (
        <p className="search-result-count">
          {rows.length} of {allRows.length} cuttings match "{q}"
        </p>
      )}

      <CuttingsBatchTable rows={rows.map(toTableRow)} />
    </div>
  );
}
