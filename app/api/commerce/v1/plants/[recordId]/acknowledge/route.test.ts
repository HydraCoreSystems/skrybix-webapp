import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { handleAcknowledgeRequest } from "./handler.ts";
import type { SupabaseServerClient } from "@/lib/supabase";

// Route-level regression tests for the acknowledgement-response
// discriminator fix. These exercise the real handler
// (handleAcknowledgeRequest, extracted from POST purely so it can be
// called directly here without a live Supabase connection) against
// actual NextRequest objects and read the actual response JSON --
// not source-code string matching. A minimal fake Supabase client
// stands in for the real one, modeling only the exact
// from().update()/select().eq()/not()/is().maybeSingle() chains this
// route actually calls.

const TOKEN = "route-test-token";
process.env.COMMERCE_EXPORT_KEY = TOKEN;

type Row = Record<string, unknown>;

function idColumn(table: string): string {
  if (table === "cuttings") return "cutting_id";
  if (table === "mother_plants") return "mother_id";
  if (table === "mother_commerce_facts") return "source_record_id";
  throw new Error(`fake supabase: unknown table "${table}"`);
}

function createFakeSupabase(seed: { cuttings?: Row[]; mother_plants?: Row[]; mother_commerce_facts?: Row[] }) {
  const tables: Record<string, Row[]> = {
    cuttings: (seed.cuttings ?? []).map((row) => ({ ...row })),
    mother_plants: (seed.mother_plants ?? []).map((row) => ({ ...row })),
    mother_commerce_facts: (seed.mother_commerce_facts ?? []).map((row) => ({ ...row })),
  };

  function from(table: string) {
    let mode: "select" | "update" = "select";
    let patch: Row | null = null;
    const filters: Array<{ type: "eq" | "not-is" | "is"; col: string; val: unknown }> = [];

    const builder = {
      update(p: Row) {
        mode = "update";
        patch = p;
        return builder;
      },
      select(_columns: string) {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ type: "eq", col, val });
        return builder;
      },
      not(col: string, _op: "is", val: unknown) {
        filters.push({ type: "not-is", col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ type: "is", col, val });
        return builder;
      },
      async maybeSingle() {
        const rows = tables[table];
        const matches = rows.filter((row) =>
          filters.every((f) => {
            if (f.type === "eq") return row[f.col] === f.val;
            if (f.type === "is") return row[f.col] === f.val;
            if (f.type === "not-is") return row[f.col] !== f.val;
            return true;
          })
        );
        if (matches.length > 1) {
          return { data: null, error: { message: `fake supabase: ${table} matched >1 row unexpectedly` } };
        }
        const row = matches[0] ?? null;
        if (mode === "update" && row) {
          Object.assign(row, patch);
        }
        return { data: row ? { ...row } : null, error: null };
      },
    };
    return builder;
  }

  return { client: { from } as unknown as SupabaseServerClient, tables };
}

function acknowledgeRequest(recordId: string, body?: Record<string, unknown>) {
  return new NextRequest(`https://example.com/api/commerce/v1/plants/${recordId}/acknowledge`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const NOW = "2026-08-15T00:00:00.000Z";

function seedCutting(overrides: Row = {}): Row {
  return {
    cutting_id: "HY-ICE01-C01",
    mother_id: "HY-ICE01",
    full_display_name: "Hoya iceana",
    sold: false,
    archived_at: null,
    created_at: NOW,
    commerce_selected_at: NOW,
    commerce_acknowledged_at: null,
    ...overrides,
  };
}

function seedMother(overrides: Row = {}): Row {
  return {
    mother_id: "HY-XYZ01",
    display_name: "Hoya whole-mother example",
    sold: false,
    created_at: NOW,
    commerce_selected_at: NOW,
    commerce_acknowledged_at: null,
    ...overrides,
  };
}

function seedFacts(overrides: Row = {}): Row {
  return {
    source_record_id: "HY-XYZ01",
    photo_subject: "exact_plant",
    pot_size: "6in",
    plant_size: "18in vine",
    rooted_established: true,
    shipping_presentation: "ships_in_pot",
    shipping_presentation_detail: null,
    condition_notes: null,
    ...overrides,
  };
}

test("cutting first-time acknowledgement: 200 response has both top-level and nested plantRecordType 'cutting'", async () => {
  const { client } = createFakeSupabase({ cuttings: [seedCutting()] });
  const response = await handleAcknowledgeRequest(
    acknowledgeRequest("HY-ICE01-C01", { plantRecordType: "cutting" }),
    "HY-ICE01-C01",
    client
  );
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.plantRecordType, "cutting", "top-level discriminator must be present");
  assert.equal(json.record.plantRecordType, "cutting", "nested discriminator must be preserved");
  assert.equal(json.record.sourceRecordId, "HY-ICE01-C01");
  assert.equal(json.alreadyAcknowledged, false);
});

test("mother first-time acknowledgement: 200 response has both top-level and nested plantRecordType 'mother'", async () => {
  const { client } = createFakeSupabase({
    mother_plants: [seedMother()],
    mother_commerce_facts: [seedFacts()],
  });
  const response = await handleAcknowledgeRequest(
    acknowledgeRequest("HY-XYZ01", { plantRecordType: "mother" }),
    "HY-XYZ01",
    client
  );
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.plantRecordType, "mother", "top-level discriminator must be present");
  assert.equal(json.record.plantRecordType, "mother", "nested discriminator must be preserved");
  assert.equal(json.record.sourceRecordId, "HY-XYZ01");
  assert.equal(json.alreadyAcknowledged, false);
});

test("already-acknowledged cutting replay echoes top-level plantRecordType 'cutting'", async () => {
  const { client } = createFakeSupabase({
    cuttings: [seedCutting({ commerce_acknowledged_at: "2026-08-14T00:00:00.000Z" })],
  });
  const response = await handleAcknowledgeRequest(
    acknowledgeRequest("HY-ICE01-C01", { plantRecordType: "cutting" }),
    "HY-ICE01-C01",
    client
  );
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.plantRecordType, "cutting");
  assert.equal(json.record.plantRecordType, "cutting");
  assert.equal(json.alreadyAcknowledged, true, "idempotent replay must be reported");
});

test("already-acknowledged mother replay echoes top-level plantRecordType 'mother'", async () => {
  const { client } = createFakeSupabase({
    mother_plants: [seedMother({ commerce_acknowledged_at: "2026-08-14T00:00:00.000Z" })],
    mother_commerce_facts: [seedFacts()],
  });
  const response = await handleAcknowledgeRequest(
    acknowledgeRequest("HY-XYZ01", { plantRecordType: "mother" }),
    "HY-XYZ01",
    client
  );
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.plantRecordType, "mother");
  assert.equal(json.record.plantRecordType, "mother");
  assert.equal(json.alreadyAcknowledged, true, "idempotent replay must be reported");
});

test("wrong discriminator fails closed: addressing a mother's ID as a cutting returns 404 and never touches the mother record", async () => {
  const { client, tables } = createFakeSupabase({
    mother_plants: [seedMother({ mother_id: "HY-WRONG01" })],
    mother_commerce_facts: [seedFacts({ source_record_id: "HY-WRONG01" })],
  });
  const response = await handleAcknowledgeRequest(
    acknowledgeRequest("HY-WRONG01", { plantRecordType: "cutting" }),
    "HY-WRONG01",
    client
  );
  assert.equal(response.status, 404, "must fail closed rather than fall back to trying the mother table");
  const json = await response.json();
  assert.equal(json.error, "Unknown cutting.");
  const motherRow = tables.mother_plants.find((row) => row.mother_id === "HY-WRONG01");
  assert.equal(
    motherRow?.commerce_acknowledged_at,
    null,
    "the mother record must remain unacknowledged -- the wrong-type request must never fall through to it"
  );
});

test("missing/invalid auth still fails closed with 401 regardless of discriminator", async () => {
  const { client } = createFakeSupabase({ cuttings: [seedCutting()] });
  const request = new NextRequest("https://example.com/api/commerce/v1/plants/HY-ICE01-C01/acknowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plantRecordType: "cutting" }),
  });
  const response = await handleAcknowledgeRequest(request, "HY-ICE01-C01", client);
  assert.equal(response.status, 401);
});
