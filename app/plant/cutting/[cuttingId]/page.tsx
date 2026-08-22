import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { CUTTING_INSTAGRAM_URL } from "@/lib/qr";

export const dynamic = "force-dynamic";

// Newly generated cutting QR codes now encode CUTTING_INSTAGRAM_URL
// directly (see lib/qr.ts) -- a customer's phone shows the raw encoded
// URL as a scan preview before they even tap it, so a redirect through
// this route still isn't good enough for freshly printed labels. This
// route survives only as a safety net for any already-printed label
// still carrying the old Skrybix-URL QR: it records the scan, then
// redirects here too, so an old label doesn't show any internal app UI.
export default async function PublicCuttingPage({ params }: { params: { cuttingId: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: cuttingRaw, error: cuttingError } = await supabase
    .from("cuttings")
    .select("cutting_id")
    .eq("cutting_id", params.cuttingId)
    .maybeSingle();

  // Same reasoning as the mother plant page: a DB error must surface
  // visibly, not read as an identical-looking "unknown cutting" 404.
  if (cuttingError) {
    throw new Error(`Unable to look up this cutting: ${cuttingError.message}`);
  }
  if (!cuttingRaw) notFound();

  await supabase.rpc("increment_cutting_scan_count", { p_cutting_id: params.cuttingId });

  redirect(CUTTING_INSTAGRAM_URL);
}
