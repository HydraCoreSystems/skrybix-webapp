import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Fixed brand handle, matches the QR code already printed on the
// physical Brother cutting labels (GM_Cutting_Label_18mm.lbx) — update
// here if the handle ever changes.
const INSTAGRAM_HANDLE = "gathering_moss_ftw";
const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}`;

// A cutting label ships out with the plant to a real customer -- they
// must never see any part of the internal Skrybix app (nav, branding,
// inventory data), only the business's actual public presence. This
// page exists purely to record a scan (scan_count) and then redirect
// straight to Instagram before anything renders, matching what the
// original physical Brother labels did (QR -> Instagram directly).
export default async function PublicCuttingPage({ params }: { params: { cuttingId: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: cuttingRaw } = await supabase
    .from("cuttings")
    .select("cutting_id")
    .eq("cutting_id", params.cuttingId)
    .maybeSingle();

  if (!cuttingRaw) notFound();

  await supabase.rpc("increment_cutting_scan_count", { p_cutting_id: params.cuttingId });

  redirect(INSTAGRAM_URL);
}
