import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { Cutting } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicCuttingPage({ params }: { params: { cuttingId: string } }) {
  const supabase = getSupabaseServerClient();
  const { data: cuttingRaw } = await supabase
    .from("cuttings")
    .select("*")
    .eq("cutting_id", params.cuttingId)
    .maybeSingle();

  const cutting = cuttingRaw as Cutting | null;
  if (!cutting) notFound();

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
    </div>
  );
}
