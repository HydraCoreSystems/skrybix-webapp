import { NextRequest, NextResponse } from "next/server";
import {
  isCommerceExportRequestAuthorized,
  normalizeCuttingForCommerce,
  normalizeMotherForCommerce,
  CUTTING_COMMERCE_COLUMNS,
  MOTHER_COMMERCE_COLUMNS,
  MOTHER_COMMERCE_FACTS_COLUMNS,
  type CuttingCommerceSource,
  type MotherCommerceSource,
  type MotherCommerceFactsSource,
} from "@/lib/commerce-export";
import { getSupabaseServerClient, type SupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PlantRecordType = "cutting" | "mother";

async function lookupMotherFacts(
  supabase: SupabaseServerClient,
  motherId: string
): Promise<MotherCommerceFactsSource | null> {
  const { data, error } = await supabase
    .from("mother_commerce_facts")
    .select(MOTHER_COMMERCE_FACTS_COLUMNS)
    .eq("source_record_id", motherId)
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to resolve Skrybix mother commerce facts: ${error.message}`);
  }
  return (data as MotherCommerceFactsSource | null) ?? null;
}

// Reads an optional type discriminator so a caller that already knows
// which table a record lives in can address it unambiguously even under
// a (currently theoretical, never DB-enforced against each other)
// mother_id/cutting_id collision -- see the design report and the
// composite-identity coverage in lib/commerce-export.test.ts. Accepted
// as either a `plantRecordType` JSON body field or a `plantRecordType`
// query parameter, so the URL shape (`/plants/:recordId/acknowledge`)
// never has to change. Invalid values are rejected outright rather than
// silently ignored. Omitting it entirely still works, falling back to
// the pre-existing try-cutting-then-mother heuristic below, for GM
// Commerce integrations that predate this discriminator -- but that
// fallback is unsafe under a real collision, which is exactly why a
// caller that can supply the discriminator should. Unchanged by the
// existing-ID-as-SKU correction.
async function readPlantRecordTypeHint(request: NextRequest): Promise<PlantRecordType | null | { error: string }> {
  const queryValue = request.nextUrl.searchParams.get("plantRecordType");
  if (queryValue) {
    if (queryValue !== "cutting" && queryValue !== "mother") {
      return { error: `Invalid plantRecordType query parameter "${queryValue}" -- must be "cutting" or "mother".` };
    }
    return queryValue;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body && typeof body === "object" && "plantRecordType" in body) {
    const value = (body as { plantRecordType?: unknown }).plantRecordType;
    if (value !== "cutting" && value !== "mother") {
      return { error: `Invalid plantRecordType body field "${String(value)}" -- must be "cutting" or "mother".` };
    }
    return value;
  }
  return null;
}

async function acknowledgeCutting(supabase: SupabaseServerClient, recordId: string, acknowledgedAt: string) {
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

  return null;
}

async function acknowledgeMother(supabase: SupabaseServerClient, recordId: string, acknowledgedAt: string) {
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
    const facts = await lookupMotherFacts(supabase, recordId);
    return NextResponse.json(
      {
        record: normalizeMotherForCommerce({ ...motherRow, archived_at: null } as MotherCommerceSource, facts),
        alreadyAcknowledged: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
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
    const facts = await lookupMotherFacts(supabase, recordId);
    return describeAcknowledgeFailure({ ...existingMother, archived_at: null } as MotherCommerceSource, (row) =>
      normalizeMotherForCommerce(row, facts)
    );
  }

  return null;
}

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

  const hint = await readPlantRecordTypeHint(request);
  if (hint && typeof hint === "object" && "error" in hint) {
    return NextResponse.json({ error: hint.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const supabase = getSupabaseServerClient();
  const acknowledgedAt = new Date().toISOString();
  const recordId = params.recordId;

  // When the caller supplies plantRecordType, address that table only --
  // unambiguous even under a mother_id/cutting_id collision, and the
  // point of accepting the discriminator at all. Without it, fall back to
  // the pre-existing "try cuttings first, then mother_plants" heuristic,
  // which is only unsafe in the (currently nonexistent, per the resolved
  // production legacy-inventory check) case of a real collision.
  if (hint === "cutting") {
    const result = await acknowledgeCutting(supabase, recordId, acknowledgedAt);
    if (result) return result;
    return NextResponse.json({ error: "Unknown cutting." }, { status: 404 });
  }
  if (hint === "mother") {
    const result = await acknowledgeMother(supabase, recordId, acknowledgedAt);
    if (result) return result;
    return NextResponse.json({ error: "Unknown mother plant." }, { status: 404 });
  }

  const cuttingResult = await acknowledgeCutting(supabase, recordId, acknowledgedAt);
  if (cuttingResult) return cuttingResult;

  const motherResult = await acknowledgeMother(supabase, recordId, acknowledgedAt);
  if (motherResult) return motherResult;

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
