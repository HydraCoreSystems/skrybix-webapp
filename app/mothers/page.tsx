import Link from "next/link";
import { CommerceSkuSelectionForm } from "@/components/CommerceSkuSelectionForm";
import { getCommerceHandoffState } from "@/lib/commerce-export";
import { getSupabaseServerClient } from "@/lib/supabase";
import { toggleMotherField } from "./actions";
import { matchesQuery } from "@/lib/search";
import SearchBox from "@/components/SearchBox";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function printedLabel(mother: MotherPlant) {
  if (!mother.label_last_printed_at) return null;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(mother.label_last_printed_at)
  );
  return `Printed ${when} · ${mother.label_print_count}×`;
}

export default async function MothersPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; q?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw, error: rowsError } = await supabase.from("mother_plants").select("*").order("mother_id");
  if (rowsError) {
    throw new Error(`Unable to load mother plants: ${rowsError.message}`);
  }
  const allRows = (rowsRaw ?? []) as MotherPlant[];
  const q = searchParams.q ?? "";
  const rows = allRows.filter((m) =>
    matchesQuery([m.mother_id, m.display_name, m.location, m.species, m.cultivar, m.botanical_line1, m.botanical_line2], q)
  );

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
                    {m.print_label ? "Queued ✓" : m.label_print_count > 0 ? "Reprint" : "Queue for print"}
                  </button>
                </form>
                {printedLabel(m) && <small style={{ display: "block", marginTop: 5 }}>{printedLabel(m)}</small>}
              </td>
              <td>
                <CommerceSkuSelectionForm
                  recordId={m.mother_id}
                  kind="mother"
                  initialState={getCommerceHandoffState(m)}
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
