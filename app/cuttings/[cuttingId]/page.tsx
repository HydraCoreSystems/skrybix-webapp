import Link from "next/link";
import { notFound } from "next/navigation";
import CuttingProfileActions from "@/components/CuttingProfileActions";
import { getCommerceHandoffState } from "@/lib/commerce-export";
import { cuttingHandoffLabel, cuttingInventoryState } from "@/lib/cutting-profile";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { Cutting, MotherPlant, OutgoingLogEntry } from "@/lib/types";
import { routeRecordId } from "@/lib/route-record-id";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

export default async function CuttingProfilePage({ params }: { params: { cuttingId: string } }) {
  const supabase = getSupabaseServerClient();
  const cuttingId = routeRecordId(params.cuttingId);
  const { data: cuttingRaw, error: cuttingError } = await supabase.from("cuttings").select("*").eq("cutting_id", cuttingId).maybeSingle();
  if (cuttingError) throw new Error(`Unable to load cutting ${cuttingId}: ${cuttingError.message}`);
  if (!cuttingRaw) notFound();
  const cutting = cuttingRaw as Cutting;

  const [{ data: motherRaw, error: motherError }, { data: outgoingRaw, error: outgoingError }] = await Promise.all([
    supabase.from("mother_plants").select("*").eq("mother_id", cutting.mother_id).maybeSingle(),
    supabase.from("outgoing_log").select("*").eq("cutting_id", cutting.cutting_id).order("date_out", { ascending: false }).order("id", { ascending: false }),
  ]);
  if (motherError) throw new Error(`Unable to load mother plant for ${cutting.cutting_id}: ${motherError.message}`);
  if (outgoingError) throw new Error(`Unable to load outgoing history for ${cutting.cutting_id}: ${outgoingError.message}`);
  const mother = motherRaw as MotherPlant | null;
  const outgoing = (outgoingRaw ?? []) as OutgoingLogEntry[];

  return <div className="mother-profile cutting-profile">
    <div className="profile-breadcrumbs"><Link href="/cuttings">← Cuttings</Link><span>{cutting.cutting_id}</span></div>
    <section className="card mother-profile-hero"><div><p className="eyebrow">Physical cutting profile</p><h1>{cutting.full_display_name || cutting.label_line1 || "Unnamed cutting"}</h1><code>{cutting.cutting_id}</code><p className="profile-botanical">{[cutting.label_line1, cutting.label_line2].filter(Boolean).join(" · ") || "Label text not recorded"}</p></div><div className="profile-primary-actions">{mother && <Link className="btn" href={`/mothers/${encodeURIComponent(mother.mother_id)}`}>View mother plant</Link>}<Link className="btn secondary" href={`/cuttings?q=${encodeURIComponent(cutting.cutting_id)}`}>Open in workbench</Link></div></section>

    <div className="profile-stat-grid"><div className="stat"><div className="num profile-status-word">{cuttingInventoryState(cutting)}</div><div className="label">Inventory state</div></div><div className="stat"><div className="num">{cutting.label_print_count}</div><div className="label">Labels printed</div></div><div className="stat"><div className="num profile-status-word">{cuttingHandoffLabel(cutting)}</div><div className="label">GM Commerce</div></div><div className="stat"><div className="num">{outgoing.length}</div><div className="label">Outgoing records</div></div></div>

    <div className="profile-columns">
      <section className="card"><h3>Cutting record</h3><dl className="profile-details"><div><dt>Cutting ID / SKU</dt><dd><code>{cutting.cutting_id}</code></dd></div><div><dt>Date taken</dt><dd>{dateLabel(cutting.date_taken)}</dd></div><div><dt>Created</dt><dd>{dateLabel(cutting.created_at)}</dd></div><div><dt>Current state</dt><dd>{cuttingInventoryState(cutting)}</dd></div><div><dt>Archived</dt><dd>{cutting.archived_at ? dateLabel(cutting.archived_at) : "No"}</dd></div></dl></section>
      <section className="card"><h3>Source mother plant</h3>{mother ? <><p className="profile-species-name"><strong>{mother.display_name}</strong></p><dl className="profile-details"><div><dt>Mother ID</dt><dd><code>{mother.mother_id}</code></dd></div><div><dt>Location</dt><dd>{mother.location || "Not assigned"}</dd></div><div><dt>Botanical name</dt><dd>{[mother.botanical_line1, mother.botanical_line2].filter(Boolean).join(" · ") || "Not recorded"}</dd></div></dl><Link className="btn small secondary" href={`/mothers/${encodeURIComponent(mother.mother_id)}`}>Open connected mother profile</Link></> : <div className="flash error">The source mother record is missing. The cutting remains preserved, but its lineage needs attention.</div>}</section>
    </div>

    <div className="profile-columns">
      <section className="card"><h3>Label history</h3><dl className="profile-details"><div><dt>Queue state</dt><dd>{cutting.print_label ? "Queued for printing" : "Not queued"}</dd></div><div><dt>Confirmed prints</dt><dd>{cutting.label_print_count}×</dd></div><div><dt>Last printed</dt><dd>{dateLabel(cutting.label_last_printed_at)}</dd></div><div><dt>Legacy label visits</dt><dd>{cutting.scan_count}</dd></div></dl></section>
      <section className="card"><h3>GM Commerce handoff</h3><dl className="profile-details"><div><dt>Status</dt><dd>{cutting.commerce_acknowledged_at ? "Received by GM Commerce" : cutting.commerce_selected_at ? "Selected; awaiting receipt" : "Not sent"}</dd></div><div><dt>Selected</dt><dd>{dateLabel(cutting.commerce_selected_at)}</dd></div><div><dt>Acknowledged</dt><dd>{dateLabel(cutting.commerce_acknowledged_at)}</dd></div><div><dt>Commerce SKU</dt><dd><code>{cutting.cutting_id}</code></dd></div></dl>{cutting.commerce_acknowledged_at && <a className="btn small secondary" href="https://gm-commerce-ten.vercel.app/products" target="_blank" rel="noreferrer">Open GM Commerce</a>}</section>
    </div>

    <CuttingProfileActions cuttingId={cutting.cutting_id} archived={Boolean(cutting.archived_at)} sold={cutting.sold} printQueued={cutting.print_label} printCount={cutting.label_print_count} commerceState={getCommerceHandoffState(cutting)} />

    <section className="card"><p className="eyebrow">Permanent physical history</p><h3>Outgoing disposition</h3>{outgoing.length ? <div className="profile-timeline">{outgoing.map((entry) => <article key={entry.id}><time>{dateLabel(entry.date_out)}</time><div><strong>{entry.reason || "Outgoing"}</strong><p>{entry.selling_platform || "No destination recorded"}{entry.notes ? ` — ${entry.notes}` : ""}</p></div></article>)}</div> : <p className="muted">This cutting has not left active inventory.</p>}</section>
  </div>;
}
