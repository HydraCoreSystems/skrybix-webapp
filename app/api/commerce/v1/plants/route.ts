import { NextRequest, NextResponse } from "next/server";
import {
  createCommerceExport,
  isCommerceExportRequestAuthorized,
  CUTTING_COMMERCE_COLUMNS,
  MOTHER_COMMERCE_COLUMNS,
  MOTHER_COMMERCE_FACTS_COLUMNS,
  type CuttingCommerceSource,
  type MotherCommerceSource,
  type MotherCommerceFactsSource,
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

  const { data: cuttings, error: cuttingsError } = await supabase
    .from("cuttings")
    .select(CUTTING_COMMERCE_COLUMNS)
    .not("commerce_selected_at", "is", null)
    .is("commerce_acknowledged_at", null)
    .order("cutting_id");

  if (cuttingsError) {
    throw new Error(`Unable to export Skrybix commerce records: ${cuttingsError.message}`);
  }

  // Whole mother plants can be listed for sale too, added 2026-08-13 --
  // mother_plants has no archived_at column, so that field is always
  // null for these records rather than read from the DB (see
  // MotherCommerceSource in lib/commerce-export.ts).
  const { data: mothersRaw, error: mothersError } = await supabase
    .from("mother_plants")
    .select(MOTHER_COMMERCE_COLUMNS)
    .not("commerce_selected_at", "is", null)
    .is("commerce_acknowledged_at", null)
    .order("mother_id");

  if (mothersError) {
    throw new Error(`Unable to export Skrybix commerce records: ${mothersError.message}`);
  }

  const mothers = (mothersRaw ?? []).map((m) => ({ ...m, archived_at: null })) as MotherCommerceSource[];

  // sku is never looked up -- it's the record's own cutting_id/mother_id,
  // computed directly by createCommerceExport()/normalize*ForCommerce()
  // (see the existing-ID-as-SKU correction record in CLAUDE.md).
  // commerce_skus is deliberately not queried here.
  const motherIds = mothers.map((m) => m.mother_id);
  const motherFactsByRecordId = new Map<string, MotherCommerceFactsSource>();
  if (motherIds.length > 0) {
    const { data: factRows, error: factsError } = await supabase
      .from("mother_commerce_facts")
      .select(MOTHER_COMMERCE_FACTS_COLUMNS)
      .in("source_record_id", motherIds);

    if (factsError) {
      throw new Error(`Unable to resolve Skrybix mother commerce facts: ${factsError.message}`);
    }
    for (const row of factRows ?? []) {
      motherFactsByRecordId.set(row.source_record_id as string, row as MotherCommerceFactsSource);
    }
  }

  return NextResponse.json(
    createCommerceExport(
      (cuttings ?? []) as CuttingCommerceSource[],
      mothers,
      motherFactsByRecordId,
      new Date().toISOString()
    ),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
