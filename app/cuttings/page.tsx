import Link from "next/link";
import { CommerceSkuSelectionForm } from "@/components/CommerceSkuSelectionForm";
import { getCommerceHandoffState } from "@/lib/commerce-export";
import { getCommerceCodeOptions } from "@/lib/commerce-codes";
import { getSupabaseServerClient } from "@/lib/supabase";
import { toggleCuttingField, pushSoldToOutgoingLog } from "./actions";
import { matchesQuery } from "@/lib/search";
import SearchBox from "@/components/SearchBox";
import type { Cutting } from "@/lib/types";

type CuttingRow = Cutting & { mother_plants: { display_name: string } | null };

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function CuttingsPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; q?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase
    .from("cuttings")
    .select("*, mother_plants(display_name)")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  const allRows = (rowsRaw ?? []) as CuttingRow[];
  const q = searchParams.q ?? "";
  const rows = allRows.filter((c) => matchesQuery([c.cutting_id, c.mother_id, c.mother_plants?.display_name], q));

  const { genusCodes, plantCodes } = await getCommerceCodeOptions();

  const selectedIds = rows.filter((c) => c.commerce_selected_at).map((c) => c.cutting_id);
  const skusByRecordId = new Map<string, string>();
  if (selectedIds.length > 0) {
    const { data: skuRows } = await supabase
      .from("commerce_skus")
      .select("source_record_id,sku")
      .in("source_record_id", selectedIds);
    for (const row of skuRows ?? []) {
      skusByRecordId.set(row.source_record_id as string, row.sku as string);
    }
  }

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
          <Link className="btn secondary" href="/api/labels/cuttings.csv">
            Export queued → CSV
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

      <table>
        <thead>
          <tr>
            <th>Cutting ID</th>
            <th>Mother</th>
            <th>Date Taken</th>
            <th>Sold?</th>
            <th>Print?</th>
            <th>GM Commerce</th>
            <th>Scans</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.cutting_id}>
              <td>{c.cutting_id}</td>
              <td>
                {c.mother_plants?.display_name} ({c.mother_id})
              </td>
              <td>{c.date_taken}</td>
              <td>
                <form action={toggleCuttingField.bind(null, c.cutting_id, "sold", !c.sold)}>
                  <button className={`btn small ${c.sold ? "" : "secondary"}`} type="submit">
                    {c.sold ? "Sold ✓" : "Mark sold"}
                  </button>
                </form>
              </td>
              <td>
                <form action={toggleCuttingField.bind(null, c.cutting_id, "print_label", !c.print_label)}>
                  <button className={`btn small ${c.print_label ? "" : "secondary"}`} type="submit">
                    {c.print_label ? "Queued ✓" : "Queue for print"}
                  </button>
                </form>
              </td>
              <td>
                <CommerceSkuSelectionForm
                  recordId={c.cutting_id}
                  motherId={c.mother_id}
                  kind="cutting"
                  initialState={getCommerceHandoffState(c)}
                  sku={skusByRecordId.get(c.cutting_id)}
                  genusCodes={genusCodes}
                  plantCodes={plantCodes}
                />
              </td>
              <td>{c.scan_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
