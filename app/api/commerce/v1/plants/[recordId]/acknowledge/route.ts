import { NextRequest, NextResponse } from "next/server";
import {
  isCommerceExportRequestAuthorized,
  normalizeCuttingForCommerce,
  normalizeMotherForCommerce,
  CUTTING_COMMERCE_COLUMNS,
  MOTHER_COMMERCE_COLUMNS,
  type CuttingCommerceSource,
  type MotherCommerceSource,
} from "@/lib/commerce-export";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest, { params }: { params: { recordId: string } }) {
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
  const recordId = params.recordId;

  // Cutting_ID and Mother_ID are both real, differently-shaped
  // identifiers with no shared registry -- the only reliable way to know
  // which table a given ID belongs to is to actually look, not to
  // pattern-match the string. Try cuttings first (the more common case),
  // then mother_plants.
  const { data: cuttingRow, error: cuttingError } = await supabase
    .from("cuttings")
    .update({ commerce_acknowledged_at: acknowledgedAt })
    .eq("cutting_id", recordId)
    .not("commerce_selected_at", "is", null)
    .is("commerce_acknowledged_at", null)
    .select(CUTTING_COMMERCE_COLUMNS)
    .maybeSingle();

  if (cuttingError) {
    throw new Error(`Unable to acknowledge Skrybix commerce record: ${cuttingError.message}`);
  }
  if (cuttingRow) {
    return NextResponse.json(
      { record: normalizeCuttingForCommerce(cuttingRow as CuttingCommerceSource), alreadyAcknowledged: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const { data: motherRow, error: motherError } = await supabase
    .from("mother_plants")
    .update({ commerce_acknowledged_at: acknowledgedAt })
    .eq("mother_id", recordId)
    .not("commerce_selected_at", "is", null)
    .is("commerce_acknowledged_at", null)
    .select(MOTHER_COMMERCE_COLUMNS)
    .maybeSingle();

  if (motherError) {
    throw new Error(`Unable to acknowledge Skrybix commerce record: ${motherError.message}`);
  }
  if (motherRow) {
    return NextResponse.json(
      {
        record: normalizeMotherForCommerce({ ...motherRow, archived_at: null } as MotherCommerceSource),
        alreadyAcknowledged: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Neither table's atomic claim matched -- figure out why so the error
  // is precise (unknown id, not yet selected, or already acknowledged)
  // rather than a single generic failure either way.
  const { data: existingCutting, error: existingCuttingError } = await supabase
    .from("cuttings")
    .select(CUTTING_COMMERCE_COLUMNS)
    .eq("cutting_id", recordId)
    .maybeSingle();

  if (existingCuttingError) {
    throw new Error(`Unable to read Skrybix commerce record: ${existingCuttingError.message}`);
  }
  if (existingCutting) {
    return describeAcknowledgeFailure(existingCutting as CuttingCommerceSource, normalizeCuttingForCommerce);
  }

  const { data: existingMother, error: existingMotherError } = await supabase
    .from("mother_plants")
    .select(MOTHER_COMMERCE_COLUMNS)
    .eq("mother_id", recordId)
    .maybeSingle();

  if (existingMotherError) {
    throw new Error(`Unable to read Skrybix commerce record: ${existingMotherError.message}`);
  }
  if (existingMother) {
    return describeAcknowledgeFailure(
      { ...existingMother, archived_at: null } as MotherCommerceSource,
      normalizeMotherForCommerce
    );
  }

  return NextResponse.json({ error: "Unknown cutting or mother plant." }, { status: 404 });
}

function describeAcknowledgeFailure<T extends { commerce_selected_at: string | null; commerce_acknowledged_at: string | null }>(
  existing: T,
  normalize: (row: T) => ReturnType<typeof normalizeCuttingForCommerce>
) {
  if (!existing.commerce_selected_at) {
    return NextResponse.json({ error: "Record has not been selected for GM Commerce." }, { status: 409 });
  }
  if (existing.commerce_acknowledged_at) {
    return NextResponse.json(
      { record: normalize(existing), alreadyAcknowledged: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json({ error: "Could not acknowledge record." }, { status: 409 });
}
