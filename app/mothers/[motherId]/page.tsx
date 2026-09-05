import Link from "next/link";
import { notFound } from "next/navigation";
import { CommerceSkuSelectionForm } from "@/components/CommerceSkuSelectionForm";
import { getCommerceHandoffState } from "@/lib/commerce-export";
import type { HoyaSpeciesRecord } from "@/lib/hoya-library";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { Cutting, MotherPlant, OutgoingLogEntry } from "@/lib/types";
import { routeRecordId } from "@/lib/route-record-id";
import { deleteMother, toggleMotherField } from "../actions";
import DeleteRecordButton from "@/components/DeleteRecordButton";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

export default async function MotherProfilePage({ params }: { params: { motherId: string } }) {
  const supabase = getSupabaseServerClient();
  const motherId = routeRecordId(params.motherId);
  const { data: motherRaw, error: motherError } = await supabase.from("mother_plants").select("*").eq("mother_id", motherId).maybeSingle();
  if (motherError) throw new Error(`Unable to load mother plant ${motherId}: ${motherError.message}`);
  if (!motherRaw) notFound();
  const mother = motherRaw as MotherPlant;
  const { data: cuttingsRaw, error: cuttingsError } = await supabase.from("cuttings").select("*").eq("mother_id", mother.mother_id).order("created_at", { ascending: false });
  if (cuttingsError) throw new Error(`Unable to load cuttings for ${mother.mother_id}: ${cuttingsError.message}`);
  const cuttings = (cuttingsRaw ?? []) as Cutting[];
  const cuttingIds = cuttings.map((cutting) => cutting.cutting_id);

  let outgoing: OutgoingLogEntry[] = [];
  if (cuttingIds.length) {
    const { data, error } = await supabase.from("outgoing_log").select("*").in("cutting_id", cuttingIds).order("date_out", { ascending: false }).order("id", { ascending: false });
    if (error) throw new Error(`Unable to load outgoing history for ${mother.mother_id}: ${error.message}`);
    outgoing = (data ?? []) as OutgoingLogEntry[];
  }
  let species: HoyaSpeciesRecord | null = null;
  if (mother.species) {
    const { data, error } = await supabase.from("hoya_species").select("*").ilike("species", mother.species).maybeSingle();
    if (error) throw new Error(`Unable to load Hoya Library context for ${mother.mother_id}: ${error.message}`);
    species = data as HoyaSpeciesRecord | null;
  }
  const active = cuttings.filter((cutting) => !cutting.archived_at);
  const awaitingCommerce = active.filter((cutting) => cutting.commerce_selected_at && !cutting.commerce_acknowledged_at);
  const commerce = getCommerceHandoffState(mother);

  return <div className="mother-profile visual-reference-page">
    <div className="profile-breadcrumbs"><Link href="/mothers">← Mother Plants</Link><span>{mother.mother_id}</span></div>
    <section className="card mother-profile-hero"><div className="profile-hero-copy"><p className="eyebrow">Mother plant profile</p><h1>{mother.display_name}</h1><p className="profile-accession"><code>{mother.mother_id}</code><span>{mother.sold ? "Archived collection record" : "Living collection"}</span></p><p className="profile-botanical">{[mother.botanical_line1, mother.botanical_line2].filter(Boolean).join(" · ") || "Botanical label not recorded"}</p></div><div className="profile-primary-actions"><Link className="btn warm" href={`/cuttings/new?mother=${encodeURIComponent(mother.mother_id)}`}>Take cuttings</Link><Link className="btn secondary warm" href={`/mothers/${encodeURIComponent(mother.mother_id)}/edit`}>Edit profile</Link></div></section>
    <div className="profile-stat-grid"><div className="stat"><div className="num">{active.length}</div><div className="label">Active cuttings</div></div><div className="stat"><div className="num">{cuttings.length}</div><div className="label">Cuttings produced</div></div><div className="stat"><div className="num">{outgoing.length}</div><div className="label">Outgoing records</div></div><div className="stat"><div className="num">{awaitingCommerce.length}</div><div className="label">Waiting on GM Commerce</div></div></div>
    <div className="profile-columns">
      <section className="card"><h3>Collection record</h3><dl className="profile-details"><div><dt>Status</dt><dd>{mother.sold ? "Marked sold" : "In collection"}</dd></div><div><dt>Location</dt><dd>{mother.location || "Not assigned"}</dd></div><div><dt>Added</dt><dd>{dateLabel(mother.created_at)}</dd></div><div><dt>Label</dt><dd>{mother.print_label ? "Queued to print" : mother.label_print_count ? `Printed ${mother.label_print_count}×` : "Not printed"}</dd></div><div><dt>Public label visits</dt><dd>{mother.scan_count}</dd></div><div><dt>Notes</dt><dd>{mother.notes || "No notes recorded"}</dd></div></dl><div className="profile-secondary-actions"><form action={toggleMotherField.bind(null, mother.mother_id, "print_label", !mother.print_label)}><button className="btn small secondary" type="submit">{mother.print_label ? "Remove from print queue" : mother.label_print_count ? "Queue reprint" : "Queue label"}</button></form><form action={toggleMotherField.bind(null, mother.mother_id, "sold", !mother.sold)}><button className="btn small secondary" type="submit">{mother.sold ? "Restore active" : "Mark sold"}</button></form><Link className="btn small secondary" href={`/plant/${encodeURIComponent(mother.mother_id)}`} target="_blank">Public page</Link></div></section>
      <section className="card"><h3>Hoya Library context</h3>{species ? <><p className="profile-species-name"><em>{species.genus} {species.species}</em> {species.authority}</p><dl className="profile-details"><div><dt>Native range</dt><dd>{species.native_range || "Not recorded"}</dd></div><div><dt>Region</dt><dd>{species.region_group || "Not recorded"}</dd></div><div><dt>Growth habit</dt><dd>{species.growth_habit || "Not recorded"}</dd></div><div><dt>Bloom notes</dt><dd>{species.bloom_notes || "Not recorded"}</dd></div></dl><Link className="btn small secondary" href={`/hoya-library?q=${encodeURIComponent(species.species)}`}>Open in Hoya Library</Link></> : <p className="muted">No species-level Kew/POWO reference is linked for this cultivar, hybrid, or unidentified plant.</p>}</section>
    </div>
    <section className="card"><div className="page-header"><div><p className="eyebrow">Current propagation inventory</p><h3>Active cuttings</h3></div><Link className="btn small secondary" href={`/cuttings?q=${encodeURIComponent(mother.mother_id)}`}>Open in Cuttings workbench</Link></div>{active.length ? <div className="profile-cutting-grid">{active.map((cutting) => <article key={cutting.cutting_id}><strong><Link href={`/cuttings/${encodeURIComponent(cutting.cutting_id)}`}>{cutting.cutting_id}</Link></strong><span>Taken {dateLabel(cutting.date_taken)}</span><span>{cutting.sold ? "Marked sold" : "Active"} · {cutting.print_label ? "Label queued" : cutting.label_print_count ? "Label printed" : "No label yet"}</span><span>{cutting.commerce_acknowledged_at ? "GM Commerce received" : cutting.commerce_selected_at ? "Waiting on GM Commerce" : "Not sent to commerce"}</span></article>)}</div> : <div className="worklist-empty"><strong>No active cuttings.</strong><p>Use “Take cuttings” when this mother is ready to propagate.</p></div>}</section>
    <section className="card"><p className="eyebrow">Physical disposition history</p><h3>Outgoing descendants</h3>{outgoing.length ? <div className="profile-timeline">{outgoing.map((entry) => <article key={entry.id}><time>{dateLabel(entry.date_out)}</time><div><strong>{entry.cutting_id} · {entry.reason || "Outgoing"}</strong><p>{entry.selling_platform || "No destination recorded"}{entry.notes ? ` — ${entry.notes}` : ""}</p></div></article>)}</div> : <p className="muted">No cuttings from this mother have left active inventory.</p>}</section>
    <section className="card"><p className="eyebrow">Whole mother plant</p><h3>GM Commerce handoff</h3><p className="muted">Use this only when selling the established mother itself. Individual cuttings are sent from the Cuttings workbench.</p><CommerceSkuSelectionForm recordId={mother.mother_id} kind="mother" initialState={commerce} /></section>
    <section className="card"><p className="eyebrow">Danger zone</p><h3>Delete this record</h3><p className="muted">Only for a genuine mistake or duplicate entry -- Mother IDs are otherwise permanent. Blocked automatically if cuttings, a cutting-ID counter, or a GM Commerce sale record already reference this mother.</p><DeleteRecordButton id={mother.mother_id} label="mother plant" onDelete={deleteMother} redirectTo="/mothers" /></section>
  </div>;
}
