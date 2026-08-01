import { NextRequest, NextResponse } from "next/server";
import {
  createCommerceExport,
  isCommerceExportRequestAuthorized,
  type CuttingCommerceSource,
} from "@/lib/commerce-export";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  if (!isCommerceExportRequestAuthorized(request.headers.get("authorization"), process.env.COMMERCE_EXPORT_KEY)) {
    return NextResponse.json(
      { error: "A valid GM Commerce bearer token is required." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
        },
      }
    );
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("cuttings")
    .select(
      "cutting_id,mother_id,full_display_name,sold,archived_at,created_at,commerce_selected_at,commerce_acknowledged_at"
    )
    .not("commerce_selected_at", "is", null)
    .is("commerce_acknowledged_at", null)
    .order("cutting_id");

  if (error) {
    throw new Error(`Unable to export Skrybix commerce records: ${error.message}`);
  }

  return NextResponse.json(
    createCommerceExport((data ?? []) as CuttingCommerceSource[], new Date().toISOString()),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
