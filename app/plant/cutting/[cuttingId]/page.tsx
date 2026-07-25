import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { Cutting } from "@/lib/types";

export const dynamic = "force-dynamic";

// Fixed brand handle, matches the QR code already printed on the
// physical Brother cutting labels (GM_Cutting_Label_18mm.lbx) — update
// here if the handle ever changes.
const INSTAGRAM_HANDLE = "gathering_moss_ftw";
const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}`;

export default async function PublicCuttingPage({ params }: { params: { cuttingId: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: cuttingRaw } = await supabase
    .from("cuttings")
    .select("*")
    .eq("cutting_id", params.cuttingId)
    .maybeSingle();

  const cutting = cuttingRaw as Cutting | null;
  if (!cutting) notFound();

  await supabase.rpc("increment_cutting_scan_count", { p_cutting_id: params.cuttingId });

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{cutting.cutting_id}</h3>
      <p>
        <em>{cutting.label_line1}</em>
        {cutting.label_line2 ? ` — ${cutting.label_line2}` : ""}
      </p>
      <p>Full name: {cutting.full_display_name}</p>
      <p>Date taken: {cutting.date_taken}</p>
      <p>Status: {cutting.archived_at ? "Sold" : cutting.sold ? "Marked sold" : "Active"}</p>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>
          Thanks for taking home a Gathering Moss plant!
        </p>
        <a className="btn" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
          Follow @{INSTAGRAM_HANDLE} on Instagram
        </a>
      </div>
    </div>
  );
}
