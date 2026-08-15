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

  // sku is looked up from commerce_skus, never derived from/equal to the
  // source record id (see the 2026-08-13 decision record in CLAUDE.md).
  // Every record reaching this point should already have one -- SKU
  // assignment and marking a record selected happen atomically in the
  // same transaction inside select_mother_for_commerce()/
  // select_cutting_for_commerce() -- but this is not assumed silently:
  // createCommerceExport() below throws rather than exporting a record
  // with no resolvable SKU.
  //
  // Keyed by `${plant_record_type}:${source_record_id}`, not
  // source_record_id alone -- see the comment on createCommerceExport()
  // for why a bare source_record_id key is not safe here.
  const recordIds = [...(cuttings ?? []).map((c) => c.cutting_id), ...mothers.map((m) => m.mother_id)];
  const skusByRecordId = new Map<string, string>();
  if (recordIds.length > 0) {
    const { data: skuRows, error: skusError } = await supabase
      .from("commerce_skus")
      .select("plant_record_type,source_record_id,sku")
      .in("source_record_id", recordIds);

    if (skusError) {
      throw new Error(`Unable to resolve Skrybix commerce SKUs: ${skusError.message}`);
    }
    for (const row of skuRows ?? []) {
      skusByRecordId.set(`${row.plant_record_type}:${row.source_record_id}`, row.sku as string);
    }
  }

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
      skusByRecordId,
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
