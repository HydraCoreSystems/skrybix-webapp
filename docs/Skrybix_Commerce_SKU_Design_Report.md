# Skrybix Commerce SKU Standardization — Final Design & Implementation Record

> **SUPERSEDED (2026-08-15), before ever deploying.** The genus/plant-code
> standardized-SKU design this whole document describes was reversed by
> owner decision before PR #11 deployed to production. `mother_id`/
> `cutting_id` are the commerce/Shopify SKU again, byte-for-byte — see
> `CLAUDE.md`'s decision record item 15 and PR
> `claude/existing-id-commerce-sku-correction` for the correction, its
> root cause (a real identifier-format audit found this scheme's own
> `spec3` bucketing already collapsing distinct real AH-family catalog
> numbers), and the current, authoritative contract. This document is
> kept for historical record of the superseded design and its
> verification methodology, not as a description of current behavior.

**Status as of this revision:** implemented, committed, pushed, open as a **draft** pull request (#11) against `master` on branch `claude/commerce-sku-implementation`. **Not merged. Not deployed. Not production-enabled.** No code path in production calls any function or reads any table this document describes.

This is the single authoritative document for this feature. Earlier drafts of this report existed as a design-only proposal, then accumulated dated "addendum" sections as the implementation, a blocking review, and a production data check each landed. This revision replaces all of that with one document reflecting only the final state — no superseded schema, no "still open" owner decision that has since been resolved. Where prior history matters (why a decision was made a certain way), it's noted in place, not left as a separate correction layered on top.

---

## 1. What this is and why

Skrybix's `mother_plants`/`cuttings` tables use `Mother_ID`/`Cutting_ID` as both primary key and, historically, the value handed to GM Commerce as a product identifier. That conflates two different concerns: a permanent internal source identity, and a customer-facing, standardized product SKU. This document describes the fix: a new, separate, additive `sku` concept, and the reasoning, schema, and guarantees behind it.

## 2. Owner decisions (final, all resolved)

These were decided across two "OWNER DECISION(S)" reviews and are treated as settled, not open:

- `Mother_ID` and `Cutting_ID` are **permanent source identities** and are never renamed or rewritten, for any reason, ever. Printed mother QR codes contain the literal `mother_id` (`lib/qr.ts`, `publicPlantUrl(motherId)`) baked into already-distributed physical labels — changing that value would 404 every already-printed QR code with no way to reissue history. Cutting QR codes encode a fixed Instagram URL, not an ID-based link, so they carry no equivalent risk, but `Cutting_ID` is held to the same never-rewritten rule for consistency and because `outgoing_log.cutting_id` and `cuttings.mother_id` are real foreign keys.
- Commerce SKU is a **separate, additive, immutable, globally unique** identifier, looked up by `(plantRecordType, sourceRecordId)`, never a replacement for the source ID.
- **SKU format:** `{GENUS}-{PLANT}-{MOTHER}[-C{CUTTING}]`. Examples: `HY-KRQ-01`, `HY-KRQ-02`, `HY-KRQ-02-C01`, `AL-FRY-01`.
- Genus codes are a **deliberate, human-curated registry**, never sliced from a name. Approved codes today: `HY` (Hoya), `AL` (Alocasia). No further genus codes are added speculatively.
- Plant-code uniqueness is scoped **per genus** (`unique (genus_code, code)`) — the same 3-character code can be reused across two different genera without colliding, since the full SKU always prefixes with `GENUS-`.
- SKU assignment happens **at first commerce selection**, not at record creation — most mother/cutting rows are inventory bookkeeping that never gets sold, and forcing a registry-curation step on every new row would add real friction to daily entry for no payoff.
- Selecting a cutting **reserves** its mother's SKU if the mother doesn't have one yet, without ever selecting or exporting the mother as a side effect — that stays a separate, explicit human action.
- Source identity is collision-safe as the **composite** `(plantRecordType, sourceRecordId)` — `mother_id` and `cutting_id` are each only unique within their own table, not against each other, so a bare `source_record_id` key or lookup filter is not safe (see §4 for the schema, §6 for exactly where this is enforced in application code).
- Mother and cutting listing semantics differ: cuttings export as before (no facts payload); a selected mother additionally carries a required, structured `motherFacts` payload (§7) that a cutting export never has.
- **Etsy activation and Phase 2 batch processing are explicitly out of scope** for this PR and have not been touched.

## 3. Material-conflict check

Confirmed no material conflict, under exactly the condition already baked into every decision above: the SKU is a wholly separate field, never a replacement for `Mother_ID`/`Cutting_ID`. `mother_plants` QR codes are printed with the literal current `mother_id` baked into the image on physical labels already in circulation — that is the hard constraint everything else in this design is built around, and nothing in the implementation touches it. No `UPDATE` statement anywhere in this codebase writes to `mother_id` or `cutting_id` after row creation; the mother edit form renders the ID in a `disabled` input with no `name` attribute, structurally excluded from the update payload.

## 4. Schema (final, as implemented)

Delivered two ways, kept in sync and CI-verified to be identical (§9):
- `supabase/schema.sql` — the consolidated, fresh-database reference (this repo's pre-existing convention).
- `supabase/migrations/20260813221000_commerce_sku_standardization.sql` — a new, real, timestamped forward migration (Supabase CLI convention: `supabase/migrations/<timestamp>_<name>.sql`), for applying to the already-populated production database. This is the first file in that directory; every statement in it is copied verbatim from `schema.sql` and is idempotent, so either file can be applied in either order safely, and re-applying the migration a second time is a no-op (CI-verified, §9).

```sql
create table genus_codes (
  code        char(2) primary key check (code = upper(code)),
  genus_name  text not null unique,
  created_at  timestamptz not null default now()
);
-- Seeded: ('HY','Hoya'), ('AL','Alocasia'). Not extended speculatively.

create table plant_codes (
  id            bigint generated always as identity primary key,
  genus_code    char(2) not null references genus_codes(code),
  code          text not null check (code = upper(code) and code ~ '^[A-Z0-9]{3}$'),
  display_label text not null,
  created_at    timestamptz not null default now(),
  unique (genus_code, code)
);

create table commerce_skus (
  id                bigint generated always as identity primary key,
  plant_record_type text not null check (plant_record_type in ('mother', 'cutting')),
  source_record_id  text not null,             -- existing mother_id or cutting_id, UNCHANGED
  genus_code        char(2) not null references genus_codes(code),
  plant_code        text not null,
  mother_seq        int not null,
  cutting_seq       int,                        -- null for mothers, required for cuttings
  sku               text not null unique,
  assigned_at       timestamptz not null default now(),
  unique (plant_record_type, source_record_id), -- the real composite identity
  foreign key (genus_code, plant_code) references plant_codes (genus_code, code),
  check (
    (plant_record_type = 'mother' and cutting_seq is null) or
    (plant_record_type = 'cutting' and cutting_seq is not null)
  )
);

create table commerce_mother_seq_counters (
  genus_code char(2) not null, plant_code text not null, next_seq int not null default 1,
  primary key (genus_code, plant_code)
);
create table commerce_cutting_seq_counters (
  mother_sku text primary key, next_seq int not null default 1
);
-- next_commerce_mother_seq()/next_commerce_cutting_seq(): identical
-- INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING pattern already
-- proven by the pre-existing next_mother_seq()/next_cutting_seq().

create table mother_commerce_facts (
  source_record_id             text primary key references mother_plants(mother_id),
  photo_subject                text not null check (photo_subject in ('exact_plant', 'representative_plant')),
  pot_size                     text not null,
  plant_size                   text not null,
  rooted_established           boolean not null,
  shipping_presentation        text not null check (shipping_presentation in ('ships_in_pot', 'prepared_other')),
  shipping_presentation_detail text,
  condition_notes               text,
  quantity                     int not null default 1 check (quantity = 1),
  recorded_at                  timestamptz not null default now(),
  check (shipping_presentation <> 'prepared_other' or coalesce(trim(shipping_presentation_detail), '') <> '')
);
```

**Identity design note:** `commerce_skus` uses a surrogate `id` primary key plus `unique (plant_record_type, source_record_id)`, not a bare `source_record_id primary key`. An early draft of this schema used the bare form; the owner corrected it, since `mother_id`/`cutting_id` are each only unique within their own table, not against each other (§2).

## 5. RPC / transaction flow

Two top-level entry points, each **one Postgres function body — one transaction**:

- **`select_mother_for_commerce(mother_id, genus_code, plant_code, photo_subject, pot_size, plant_size, rooted_established, shipping_presentation, shipping_presentation_detail, condition_notes) returns sku`**
  1. Verifies the mother exists (`raise exception` if not).
  2. Calls `assign_commerce_sku_for_mother()` (below).
  3. Inserts `mother_commerce_facts` (`on conflict do nothing` — idempotent).
  4. `UPDATE mother_plants SET commerce_selected_at = now() WHERE ... AND commerce_selected_at IS NULL`, then checks `row_count` via `GET DIAGNOSTICS`: zero rows is only acceptable if the mother was *already* selected (idempotent re-call); otherwise raises.
  5. All of the above commits or rolls back together.

- **`select_cutting_for_commerce(cutting_id, genus_code, plant_code) returns sku`**
  1. Verifies the cutting exists (`raise exception` if not). **There is no `mother_id` parameter** — the cutting's mother is always derived from `cuttings.mother_id` inside the database, never trusted from a caller-supplied value. A caller cannot cause a cutting's commerce SKU to be reserved under a mother it doesn't actually belong to, because there is nothing left to spoof.
  2. Calls `assign_commerce_sku_for_cutting()` (below), which internally reserves the mother's SKU first via `assign_commerce_sku_for_mother()` — that inner call only ever writes to `commerce_skus`, never to `mother_plants.commerce_selected_at`/`commerce_acknowledged_at`, so a mother is never selected or exported as a side effect of one of its cuttings being selected.
  3. Same `UPDATE ... GET DIAGNOSTICS` selected-or-already-selected check as above.

`assign_commerce_sku_for_mother()`/`assign_commerce_sku_for_cutting()` are both:
- **Idempotent** — a repeat call for an already-assigned identity returns the existing SKU without allocating a new sequence number. CI-verified (§9): calling `select_mother_for_commerce()` twice with the same identity and inputs leaves the sequence counter unchanged and returns the identical SKU both times.
- **Fail-closed on mismatch** — a repeat call for an already-assigned identity with a *different* genus/plant code raises explicitly rather than silently keeping the old assignment or silently reassigning it (SKUs are immutable, so neither silent behavior is safe).
- **Existence-checked** — raise if the target mother/cutting row doesn't exist.
- Sequence reservation (`next_commerce_mother_seq`/`next_commerce_cutting_seq`) and the `commerce_skus` insert are both inside the same function body, so a failure anywhere downstream (e.g. the mother-facts `NOT NULL` violation) rolls back the SKU assignment too — CI-verified: zero leftover `commerce_skus` rows after a deliberately failed selection.

**Documented, accepted trade-off:** under a genuine race where two callers both pass the "not yet assigned" check before either inserts, both reserve a real sequence number via `next_commerce_*_seq`, but only one insert wins (`ON CONFLICT DO NOTHING`) — the loser's number is simply never reused. This can produce small gaps in the sequence under real concurrency, never a duplicate or incorrect SKU. This is the same trade-off already accepted by the pre-existing `next_mother_seq()`/`next_cutting_seq()`, not a new risk.

**Immutability**, database-enforced, not just "no application code touches it": a `BEFORE UPDATE OR DELETE` trigger (`forbid_commerce_sku_mutation()`) unconditionally rejects both mutating operations on `commerce_skus`. Real foreign key columns (`genus_code`, `plant_code`) mean Postgres itself refuses to rename or delete a registry code already referenced by an assigned SKU — no extra trigger needed for that part. CI-verified (§9): both `UPDATE` and `DELETE` against an assigned row rejected; `UPDATE`/`DELETE` against an in-use `plant_codes`/`genus_codes` row rejected by the FK.

## 6. Composite identity in application code

Every list, lookup, acknowledgement, map, and query that touches `commerce_skus` is keyed or filtered on **both** `plant_record_type` and `source_record_id`, never `source_record_id` alone:

- `GET /api/commerce/v1/plants` (`app/api/commerce/v1/plants/route.ts`): the SKU map is keyed `` `${plant_record_type}:${source_record_id}` ``, not a bare `Map<string, string>` on `source_record_id`.
- The acknowledge route's `lookupSku()` (`app/api/commerce/v1/plants/[recordId]/acknowledge/route.ts`) takes an explicit `plantRecordType` argument and filters `.eq("source_record_id", ...).eq("plant_record_type", ...)`.
- `app/mothers/page.tsx`/`app/cuttings/page.tsx`'s own per-row SKU lookups filter `.eq("plant_record_type", "mother" | "cutting")` alongside `source_record_id`, for consistency, even though a same-page query can't itself cross tables.
- `mother_commerce_facts` is the one table intentionally keyed on `source_record_id` alone with no `plant_record_type` filter — it is mother-only by construction (its FK is `references mother_plants(mother_id)`), so there is no type ambiguity to guard against there.

**Cross-type collision proof (real, not just reasoned about):** `supabase/commerce_sku_tests.sql`'s `--- cross-type collision ---` scenario inserts a mother with `mother_id = 'HY-COL01'` and, independently, a cutting with `cutting_id = 'HY-COL01'` under a different real mother — nothing in the schema prevents this (§4's collision-risk note), so it's a real scenario, not a contrived one. Both are selected for commerce; the result is two distinct, independently-correct `commerce_skus` rows (`HY-CL1-01` for the mother, `HY-CL2-01-C01` for the cutting), each resolvable on its own via the composite key.

**Acknowledgement discriminator:** the acknowledge endpoint's URL shape is unchanged (`POST /api/commerce/v1/plants/:recordId/acknowledge`). It now additionally accepts an optional **`plantRecordType`** discriminator, as either a `plantRecordType` query parameter or a `plantRecordType` field in the JSON request body — `"cutting"` or `"mother"`, rejected with `400` if present but invalid. When supplied, the route addresses that table only, which is what makes a colliding mother reachable at all (without it, a `cutting_id`/`mother_id` collision would mean the cutting — checked first — permanently shadows the mother at that same URL). When omitted, the route falls back to its original "try cuttings, then mother_plants" heuristic, for compatibility with callers that predate this discriminator; that fallback is unsafe under a real collision, which is exactly why a caller that can supply the discriminator should. **GM Commerce should send `plantRecordType` on every acknowledge call once its own implementation is updated against this contract** — see §11 for where that fits in deployment order.

## 7. Mother-facts contract

Collected once, at first mother selection, **required**, never inferred from a name/ID/SKU, never read from the general `notes` field, enforced as real `NOT NULL`/`CHECK` columns on `mother_commerce_facts` (§4) — not merely client-side or RPC-level validation:

| Field | Type | Required | Notes |
|---|---|---|---|
| `photoSubject` | `"exact_plant" \| "representative_plant"` | yes | Whether the sale photo is of the exact plant or a representative example. |
| `potSize` | string | yes | Free text, e.g. `"6in nursery pot"`. |
| `plantSize` | string | yes | Free text, e.g. `"18in vine"`. |
| `rootedEstablished` | boolean | yes | |
| `shippingPresentation` | `"ships_in_pot" \| "prepared_other"` | yes | |
| `shippingPresentationDetail` | string \| null | **conditionally required** | Required (DB `CHECK`, not just app code) when `shippingPresentation = "prepared_other"`; otherwise must be null/omitted. |
| `conditionNotes` | string \| null | no | Optional, exportable, e.g. "recently cut back for shipping." |

Quantity is locked to `1` at the database level (`quantity int not null default 1 check (quantity = 1)`) — a selected mother record is always exactly one whole plant; revisit only if the owner later approves a different model.

**Cutting selection does not collect any of this.** Cutting content/semantics are unchanged by this PR.

### Exact exported JSON

`CommercePlantRecord` (`lib/commerce-export.ts`), the shape both `GET /api/commerce/v1/plants` and the acknowledge endpoint return per record:

```json
{
  "sourceSystem": "skrybix",
  "sourceRecordId": "HY-KRQ01",
  "sku": "HY-KRQ-01",
  "displayName": "Hoya krohniana",
  "parentSourceRecordId": null,
  "plantRecordType": "mother",
  "state": "active",
  "selectionState": "selected",
  "selectedAt": "2026-08-13T00:00:00.000Z",
  "acknowledgedAt": null,
  "archivedAt": null,
  "sourceCreatedAt": "2026-07-01T00:00:00.000Z",
  "motherFacts": {
    "photoSubject": "exact_plant",
    "potSize": "6in nursery pot",
    "plantSize": "18in vine",
    "rootedEstablished": true,
    "shippingPresentation": "ships_in_pot",
    "shippingPresentationDetail": null,
    "conditionNotes": "Recently cut back for shipping"
  }
}
```

For a **cutting** record, every field is populated the same way except:
- `plantRecordType: "cutting"`
- `parentSourceRecordId`: the cutting's mother's `sourceRecordId` (never null for a cutting)
- **`motherFacts: null`** — always, exactly `null`, never an absent/omitted key, never an object with null sub-fields. This is the "exact documented null form" a consumer should check for (`record.motherFacts === null`) to distinguish a cutting from a mother, rather than inferring it from `plantRecordType` alone if that's ever more convenient for GM Commerce's own code.

**GM Commerce must use `motherFacts` for established-whole-plant listing content (condition, pot/plant size, shipping presentation, rooted/established status) — not cutting-style language — whenever `plantRecordType === "mother"`.** A mother listing and a cutting listing are different products with different presentation needs; this payload exists specifically so GM Commerce doesn't have to guess or reuse cutting copy for a mother sale.

**Fail-closed guarantee:** `normalizeMotherForCommerce()` throws rather than exporting a selected mother with a `null`/missing `sku` or a `null`/missing `facts` row — GM Commerce will never receive a mother record with a placeholder SKU or a null-filled `motherFacts` object standing in for missing data.

## 8. Security and database privileges

This app never sends a Supabase anon/publishable key to the browser — there is no `NEXT_PUBLIC_SUPABASE_*` anything anywhere in the repository (verified by direct grep). Every access goes through `getSupabaseServerClient()` (`lib/supabase.ts`), which always uses the **service role key**.

That does not make the new tables/functions safe by default. A Supabase project provisions every object in the `public` schema with default privileges granting access to the `anon`/`authenticated` roles too (`ALTER DEFAULT PRIVILEGES ... GRANT ... TO anon, authenticated, service_role`, set up at project creation, independent of anything this app's code does), and PostgREST auto-exposes every public table and function as a REST/RPC endpoint unless that access is explicitly closed off. **Verified locally, with Supabase's real default-privilege behavior reproduced** (roles `anon`/`authenticated`/`service_role` created, `ALTER DEFAULT PRIVILEGES` applied before the schema, then `schema.sql` applied): before this PR's hardening block, the `anon` role could read `commerce_skus`, insert directly into `genus_codes`, and invoke `select_mother_for_commerce()` — all without touching this app's code or its service-role key.

**Resolution implemented in `schema.sql`/the migration** (CI-verified, §9):
- **Row Level Security enabled, with zero policies**, on every new table (`genus_codes`, `plant_codes`, `commerce_skus`, `commerce_mother_seq_counters`, `commerce_cutting_seq_counters`, `mother_commerce_facts`). RLS-enabled-with-no-policy is a default-deny for every role except `service_role`, which bypasses RLS unconditionally by Postgres/Supabase design regardless of policies — so the app's own access path is completely unaffected.
- **`EXECUTE` revoked from `PUBLIC`, `anon`, and `authenticated`**, then re-granted only to `service_role`, on every new callable function (`next_commerce_mother_seq`, `next_commerce_cutting_seq`, `assign_commerce_sku_for_mother`, `assign_commerce_sku_for_cutting`, `select_mother_for_commerce`, `select_cutting_for_commerce`). The `anon`/`authenticated` revokes are guarded by a `DO` block checking role existence first, so `schema.sql` still applies cleanly to a bare local/dev Postgres that has none of Supabase's roles.
- Every new `plpgsql` function pins `set search_path = public, pg_temp`, closing the standard Postgres search-path-hijack risk (a real, generic hardening step, independent of the RLS/grants question).

**What this deliberately does not do:** it does not add RLS to the rest of this schema (`mother_plants`, `cuttings`, `outgoing_log`, etc.), which has the same exposure today and predates this PR. That is a real, separate, wider gap — worth its own repo-wide hardening pass, not something to silently absorb into a SKU-standardization PR. Flagging it here explicitly rather than fixing it unilaterally or pretending it doesn't exist: if broader RLS adoption across this app is wanted, that's a distinct architectural decision for the owner to make deliberately, likely alongside deciding whether any client-side (non-service-role) Supabase access is ever wanted at all.

## 9. Testing and CI

**`lib/commerce-export.test.ts`** — pure-function layer (export shaping, fail-closed behavior, the `sourceRecordId`/`sku`/`motherFacts` distinctions). 9/9 passing (`npm test`): `sourceRecordId`≠`sku`, space-containing source ID validity, mother-facts export/camelCasing, fail-closed on missing SKU (3 variants), fail-closed on missing mother facts (2 variants), mixed mother/cutting export, composite-key Map behavior, genus/plant code validation.

**`supabase/commerce_sku_tests.sql`** — functional/negative-path SQL suite: genus/plant code uniqueness and shape validation, per-genus code reuse, full mother selection with real facts, the real production embedded-space case (`HY-AH 05`), nonexistent-mother/nonexistent-cutting rejection, mismatch-on-reselection rejection, `UPDATE`/`DELETE` immutability rejection (including registry FK protection), required-facts `NOT NULL` rejection with rollback-atomicity proof (zero leftover rows), the cross-type collision scenario (§6), and idempotent-replay-burns-no-sequence proof (§5).

**`supabase/verify_commerce_sku_migration.sh`** — new: a single script that orchestrates all of the above plus the schema-parity and access-hardening checks against a real Postgres server, runnable locally or in CI. It provisions the same `anon`/`authenticated`/`service_role` roles and default-privilege grants a real Supabase project has, so the access-hardening checks (§8) are exercised the same way, not merely asserted.

**`.github/workflows/commerce-sku-db.yml`** — new: **permanent CI**, replacing "a developer manually ran a SQL script once." Runs on every push to `claude/commerce-sku-implementation` and every pull request touching `supabase/**`. Two jobs:
- `verify`: spins up a real `postgres:16` service container, fetches `origin/master` (needed as the upgrade path's "simulated production" baseline), and runs `verify_commerce_sku_migration.sh`, which proves — against that real server, every run, not reasoned about on paper —
  1. `schema.sql` applies cleanly to a fresh database.
  2. The forward migration applies cleanly on top of the pre-this-PR (`origin/master`) schema, simulating current production.
  3. Both paths produce a byte-identical resulting schema (`pg_dump -s` diff, object parity).
  4. Re-applying the migration a second time produces no errors (idempotent).
  5. `anon` is denied table read, table insert, and RPC execute; `service_role` retains full access (§8).
  6. The full `commerce_sku_tests.sql` suite runs to completion with the expected rollback-atomicity result.
  7. Two real concurrent processes selecting two cuttings under the same never-before-selected mother allocate exactly one mother SKU and two distinct cutting SKUs, and never mark the mother selected.
  8. Two real concurrent processes selecting the **same** record converge on exactly one `commerce_skus` row with an identical resulting SKU.
  9. No orphaned `commerce_skus` row is left behind after a deliberately failed selection.
- `app-build-and-test`: `npm test` (unit suite) and `npm run build` (full production build, including TypeScript type-checking across the whole app — no Supabase env vars needed, since every route in this app is server-rendered on demand, confirmed by a real build with them unset).

**Concurrency-test determinism, stated honestly:** the two "real concurrency" scenarios launch two `psql` processes as close together as the shell allows, the same technique used to originally verify this behavior interactively — but the OS scheduler does not guarantee true simultaneous execution on every single run. What *is* deterministic, and asserted on every run regardless of actual interleaving, is the set of post-condition invariants (exactly one mother SKU, exactly two distinct cutting SKUs, mother never marked selected, exactly one row for the same-record case, identical SKU observed by both callers). If the `ON CONFLICT`-based atomicity these functions depend on were ever broken, these invariants would fail whether or not a given CI run happened to produce a genuine race.

**Results as of this revision:** all CI checks pass (`verify` job: all 9 steps; `app-build-and-test`: 9/9 unit tests, clean production build).

## 10. Production legacy inventory — resolved, zero backfill required

A read-only query (covering: selected/acknowledged mothers and cuttings lacking a SKU; selected/acknowledged mothers lacking `mother_commerce_facts`; any `mother_id`/`cutting_id` cross-type collision; current commerce state) was run by the owner directly against the real Skrybix Supabase database.

**Result:** exactly one record needed attention — `HY-LOB01-C04` (a cutting, mother `HY-LOB01`, selected 2026-08-02, already acknowledged by GM Commerce under the pre-this-PR `sku === sourceRecordId` behavior). No `mother_id`/`cutting_id` collisions were found in production. The owner identified `HY-LOB01-C04` as test data that should never have reached production, not a real sale — it and its matching `outgoing_log` row were **deleted** from production (not archived — archiving alone would not have removed it from either the legacy-inventory query or `GET /api/commerce/v1/plants`'s own un-archived-filtered selection, which is part of why it kept resurfacing before). Re-running the query afterward returned **zero rows** across every check.

**Net effect: this PR requires no pre-deployment backfill of any kind.** The moment the migration and application code deploy, `GET /api/commerce/v1/plants` will have nothing to fail closed on, because nothing is currently pending in production.

## 11. Required deployment order

1. Stabilize and review Skrybix PR #11 (this document, in its current state, reflects that stabilization).
2. GM Commerce implements compatibility against the final contract in this document (§6's acknowledgement discriminator, §7's `motherFacts` payload and exact JSON) — **GM Commerce is not touched by this PR or this session**.
3. GM Commerce's compatibility work merges, and its own post-merge CI passes.
4. Apply the Skrybix database migration (`supabase/migrations/20260813221000_commerce_sku_standardization.sql`) to production. Purely additive; safe on its own, since nothing reads/writes the new tables until application code does.
5. Confirm the production pending-record inventory (§10's query) is still zero, or deliberately resolve any newly-selected records the same way `HY-LOB01-C04` was resolved (assign a real SKU, or determine it's test data and remove it) before proceeding.
6. Merge and deploy Skrybix PR #11's application code.
7. Verify the live mixed feed and acknowledgements end to end against real GM Commerce traffic.
8. Only then permit unattended/worker-driven processing under the new contract.

**Fail-closed activation boundary:** Skrybix must not begin emitting the changed `sku !== sourceRecordId` contract in production before GM Commerce is ready to receive it — steps 4–6 above are the only place that contract goes live, and step 6 (this PR's own merge/deploy) is explicitly **not** part of this session's scope (see §12).

**Rollback:** revert the application-code deployment (step 6) — restores the pre-this-PR `sku = sourceRecordId` copy behavior. No data loss either direction: nothing about `mother_plants`/`cuttings` themselves is ever touched by this feature. The new tables can be left in place (inert, unreferenced, RLS-locked) or dropped; either is safe, since everything about this feature is additive.

## 12. Explicit exclusions (this session)

Not done, deliberately: GM Commerce changed; PR #11 merged or deployed; any `Mother_ID`/`Cutting_ID` value changed; Etsy activated; batch selection or Phase 2 batch processing implemented; speculative genus codes created; mother facts inferred from a name/ID/SKU; the new `sku !== sourceRecordId` feed contract enabled in production; additional production deletion beyond the one already-reported `HY-LOB01-C04` cleanup; any claim that this work is deployed or live.

## 13. Remaining risks / open items

- The concurrency-test determinism caveat in §9 — invariant-checked, not interleaving-guaranteed. Acceptable given what's actually being proven (no duplicate/incorrect SKU under contention), but worth knowing if a future reviewer expects a stronger simultaneity guarantee.
- RLS is not applied repo-wide (§8) — a real, separate, wider gap on the pre-existing tables, intentionally out of scope for this PR.
- GM Commerce has not yet implemented anything against this contract (§11 step 2) — this PR cannot move past draft into a real production cutover until that happens, independent of Skrybix's own readiness.
- No genus-code creation UI exists yet (only `HY`/`AL` are seeded via migration); adding a new genus today means a direct SQL insert. Worth a dedicated screen only if/when a third genus is actually needed.
