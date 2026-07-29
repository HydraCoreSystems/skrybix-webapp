import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { buildCsv } from "@/lib/csv";
import { CUTTING_INSTAGRAM_URL } from "@/lib/qr";
import type { Cutting } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("cuttings").select("*").eq("print_label", true);
  const rows = (rowsRaw ?? []) as Cutting[];

  if (!rows.length) {
    return NextResponse.redirect(
      new URL("/cuttings?error=" + encodeURIComponent("No cuttings flagged for print."), origin)
    );
  }

  const csv = buildCsv(
    ["Cutting_ID", "Full_Display_Name", "Label_Line1", "Label_Line2", "Date_Taken", "QR_Link"],
    rows.map((r) => [
      r.cutting_id,
      r.full_display_name,
      r.label_line1,
      r.label_line2,
      r.date_taken,
      CUTTING_INSTAGRAM_URL,
    ])
  );

  await supabase.from("cuttings").update({ print_label: false }).eq("print_label", true);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="GM_Cutting_Labels.csv"',
    },
  });
}
