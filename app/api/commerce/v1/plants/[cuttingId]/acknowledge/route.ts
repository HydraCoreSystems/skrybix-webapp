import { NextRequest, NextResponse } from "next/server";
import {
  isCommerceExportRequestAuthorized,
  normalizeCuttingForCommerce,
  type CuttingCommerceSource,
} from "@/lib/commerce-export";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest,
  { params }: { params: { cuttingId: string } }
) {
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
  const acknowledgedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("cuttings")
    .update({ commerce_acknowledged_at: acknowledgedAt })
    .eq("cutting_id", params.cuttingId)
    .not("commerce_selected_at", "is", null)
    .is("commerce_acknowledged_at", null)
    .select(
      "cutting_id,mother_id,full_display_name,sold,archived_at,created_at,commerce_selected_at,commerce_acknowledged_at"
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to acknowledge Skrybix commerce record: ${error.message}`);
  }

  if (data) {
    return NextResponse.json(
      {
        record: normalizeCuttingForCommerce(data as CuttingCommerceSource),
        alreadyAcknowledged: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("cuttings")
    .select(
      "cutting_id,mother_id,full_display_name,sold,archived_at,created_at,commerce_selected_at,commerce_acknowledged_at"
    )
    .eq("cutting_id", params.cuttingId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to read Skrybix commerce record: ${existingError.message}`);
  }
  if (!existing) {
    return NextResponse.json({ error: "Unknown cutting." }, { status: 404 });
  }
  if (!existing.commerce_selected_at) {
    return NextResponse.json({ error: "Cutting has not been selected for GM Commerce." }, { status: 409 });
  }
  if (existing.commerce_acknowledged_at) {
    return NextResponse.json(
      {
        record: normalizeCuttingForCommerce(existing as CuttingCommerceSource),
        alreadyAcknowledged: true,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json({ error: "Could not acknowledge cutting." }, { status: 409 });
}
