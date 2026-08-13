import Link from "next/link";
import { CommerceSkuSelectionForm } from "@/components/CommerceSkuSelectionForm";
import { getCommerceHandoffState } from "@/lib/commerce-export";
import { getCommerceCodeOptions } from "@/lib/commerce-codes";
import { getSupabaseServerClient } from "@/lib/supabase";
import { toggleMotherField } from "./actions";
import { matchesQuery } from "@/lib/search";
import SearchBox from "@/components/SearchBox";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function MothersPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; q?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("mother_plants").select("*").order("mother_id");
  const allRows = (rowsRaw ?? []) as MotherPlant[];
  const q = searchParams.q ?? "";
  const rows = allRows.filter((m) =>
    matchesQuery([m.mother_id, m.display_name, m.location, m.species, m.cultivar, m.botanical_line1, m.botanical_line2], q)
  );

  const { genusCodes, plantCodes } = await getCommerceCodeOptions();

  // Only fetched for rows that are actually selected/acknowledged, to
  // show the assigned SKU next to "Selected for GM Commerce" -- most
  // rows never reach commerce selection, so this is usually a small
  // lookup, not a full-table join.
  const selectedIds = rows.filter((m) => m.commerce_selected_at).map((m) => m.mother_id);
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
        <h3>Mother Plants</h3>
        <div className="actions">
          <Link className="btn" href="/mothers/new">
            + Add Mother Plant
          </Link>
          <Link className="btn secondary" href="/api/labels/mothers.csv">
            Export queued → CSV
          </Link>
          <Link className="btn secondary" href="/labels/mothers">
            View queued labels
          </Link>
        </div>
      </div>
      <SearchBox placeholder="Search by ID, name, species, location…" defaultValue={q} />
      {q && (
        <p className="search-result-count">
          {rows.length} of {allRows.length} mother plants match "{q}"
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Mother ID</th>
            <th>Display Name</th>
            <th>Location</th>
            <th>Botanical</th>
            <th>Sold?</th>
            <th>Print?</th>
            <th>GM Commerce</th>
            <th>Scans</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.mother_id}>
              <td>{m.mother_id}</td>
              <td>{m.display_name}</td>
              <td>{m.location}</td>
              <td>
                {m.botanical_line1}
                <br />
                <small>{m.botanical_line2}</small>
              </td>
              <td>
                <form action={toggleMotherField.bind(null, m.mother_id, "sold", !m.sold)}>
                  <button className={`btn small ${m.sold ? "" : "secondary"}`} type="submit">
                    {m.sold ? "Sold ✓" : "Mark sold"}
                  </button>
                </form>
              </td>
              <td>
                <form action={toggleMotherField.bind(null, m.mother_id, "print_label", !m.print_label)}>
                  <button className={`btn small ${m.print_label ? "" : "secondary"}`} type="submit">
                    {m.print_label ? "Queued ✓" : "Queue for print"}
                  </button>
                </form>
              </td>
              <td>
                <CommerceSkuSelectionForm
                  recordId={m.mother_id}
                  kind="mother"
                  initialState={getCommerceHandoffState(m)}
                  sku={skusByRecordId.get(m.mother_id)}
                  genusCodes={genusCodes}
                  plantCodes={plantCodes}
                />
              </td>
              <td>{m.scan_count}</td>
              <td>
                <Link className="btn small secondary" href={`/mothers/${encodeURIComponent(m.mother_id)}/edit`}>
                  Edit
                </Link>
              </td>
              <td>
                <Link
                  className="btn small secondary"
                  href={`/plant/${encodeURIComponent(m.mother_id)}`}
                  target="_blank"
                >
                  View public page
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
