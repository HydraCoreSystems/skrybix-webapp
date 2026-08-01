import { NextResponse } from "next/server";
import { normalizeCuttingForCommerce, type CuttingCommerceSource } from "@/lib/commerce-export";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("cuttings")
    .select("cutting_id,mother_id,full_display_name,sold,archived_at,created_at")
    .order("cutting_id");

  if (error) {
    throw new Error(`Unable to export Skrybix commerce records: ${error.message}`);
  }

  return NextResponse.json(
    {
      export_version: "1.0",
      source_system: "skrybix",
      generated_at: new Date().toISOString(),
      records: (data as CuttingCommerceSource[]).map(normalizeCuttingForCommerce),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
