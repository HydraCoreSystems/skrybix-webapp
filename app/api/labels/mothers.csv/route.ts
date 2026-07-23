import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { buildCsv } from "@/lib/csv";
import { publicPlantUrl } from "@/lib/qr";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("mother_plants").select("*").eq("print_label", true);
  const rows = (rowsRaw ?? []) as MotherPlant[];

  if (!rows.length) {
    return NextResponse.redirect(
      new URL("/mothers?error=" + encodeURIComponent("No mother plants flagged for print."), origin)
    );
  }

  const csv = buildCsv(
    ["Mother_ID", "Display_Name", "Label_Line1", "Label_Line2", "QR_Link"],
    rows.map((r) => [r.mother_id, r.display_name, r.botanical_line1, r.botanical_line2, publicPlantUrl(r.mother_id)])
  );

  await supabase.from("mother_plants").update({ print_label: false }).eq("print_label", true);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="GM_Mother_Labels.csv"',
    },
  });
}
