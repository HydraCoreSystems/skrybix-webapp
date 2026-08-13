# Skrybix Commerce SKU Standardization — Design Report

**Date:** 2026-08-13
**Status:** See "Implementation status" addendum at the end of this document for the current state — this file started as a design-only report and has since been updated as the design was reviewed and approved.
**Scope:** Answers the 12 requested points + the mother-plant content-semantics gap inventory + the material-conflict check, against the current `master` branch (post-PR #9).

---

## Material-conflict check (answered first, since it gates everything else)

**No material conflict, under one condition: the new SKU must be a wholly separate field from `Mother_ID`/`Cutting_ID`, never a replacement for them.** This matches your mid-turn decision exactly, and it's not just the safer reading — it's the only one that doesn't break something already live:

**`mother_plants` QR codes are printed with the literal current `mother_id` string baked in**, not a lookup key that could be repointed. `lib/qr.ts`:
```ts
export function publicPlantUrl(motherId: string): string {
  return `${siteUrl()}/plant/${encodeURIComponent(motherId)}`;
}
```
This URL is what's actually encoded into the QR image on every physical mother label already printed and possibly already stuck to a pot. If `mother_id` ever changed for an existing row, every already-printed QR code for that plant would 404 permanently — there's no way to reissue history. (Cutting QR codes are safe by comparison — they encode a fixed Instagram URL directly, not an ID-based link, per a deliberate fix from 2026-07-25.)

Given that, the only architecture that carries zero risk to QR codes, printed labels, the `cuttings.mother_id`/`outgoing_log.cutting_id` foreign keys, and acknowledgement history is: **`Mother_ID`/`Cutting_ID` stay exactly as they are today, forever, for every existing and future row. The new standardized SKU lives in a new, separate, additive table**, looked up by `source_record_id`, never replacing the primary key. Everything below is designed around that.

---

## 1. Current Mother_ID and Cutting_ID generation code

**Mother_ID** — `lib/mother-id.ts:12-19`:
```ts
export function deriveSpec3(species, cultivar): string | null {
  const source = (species && species.trim()) || (cultivar && cultivar.trim()) || null;
  if (!source) return null;
  return source.slice(0, 3).toUpperCase();
}
export function buildMotherId(spec3: string, seq: number): string {
  return `HY-${spec3}${String(seq).padStart(2, "0")}`;
}
```
Called from `app/mothers/actions.ts:34-58` (`createMother`), which reserves `seq` via `next_mother_seq()` (`supabase/schema.sql:92-104`, atomic UPSERT on `mother_id_counters (spec3, next_seq)`).

**Cutting_ID** — `app/cuttings/actions.ts:48-51`:
```ts
cutting_id: `${motherId}-C${String(seq).padStart(2, "0")}`,
```
`seq` reserved via `next_cutting_seq()` (`supabase/schema.sql:117-129`, atomic UPSERT on `mother_cutting_counters (mother_id, next_seq)`).

**Neither ever changes after creation** — no `UPDATE` statement anywhere touches either column; the mother edit page renders the ID in a `disabled` input with no `name` attribute (`app/mothers/[motherId]/edit/page.tsx:38`), so it's structurally excluded from the update form payload.

## 2. Everything that depends on current IDs

| Dependent | Where |
|---|---|
| `mother_plants.mother_id` | Primary key (`supabase/schema.sql:30`) |
| `cuttings.cutting_id` | Primary key (`supabase/schema.sql:133`) |
| `cuttings.mother_id` | FK → `mother_plants(mother_id)` (`:135`) |
| `mother_cutting_counters.mother_id` | FK → `mother_plants(mother_id)` (`:110`) |
| `outgoing_log.cutting_id` | FK → `cuttings(cutting_id)` (`:181`) |
| **Mother QR codes (printed, physical)** | `lib/qr.ts:9-11`, `publicPlantUrl(mother_id)` → baked into already-printed labels |
| Public mother page routing | `app/plant/[motherId]/page.tsx` — dynamic route param **is** `mother_id`, used directly in `.eq("mother_id", params.motherId)` and `increment_mother_scan_count` |
| Cutting public-page safety net | `app/plant/cutting/[cuttingId]/page.tsx` — legacy redirect only, keyed on `cutting_id` |
| Printed label text | `components/LabelSheets.tsx` renders `item.id` (= `mother_id`/`cutting_id`) as the literal printed identifier on the physical label |
| Label CSV exports | `app/api/labels/mothers.csv/route.ts:23`, `app/api/labels/cuttings.csv/route.ts:24` — both emit the raw ID |
| Cutting-creation form | `app/cuttings/new/page.tsx:22-25` — mother picker `<select>` uses `mother_id` as the option value |
| GM Commerce acknowledgement | `app/api/commerce/v1/plants/[recordId]/acknowledge/route.ts` — looks up by `cutting_id`/`mother_id` directly (this stays true under the new design — acknowledgement is keyed on `sourceRecordId`, i.e. the existing ID, never the new SKU, matching your mid-turn decision) |
| Tests | `lib/commerce-export.test.ts` uses ID-shaped strings (`HY-ABC01-C01` etc.) as fixture data, not asserting on format itself |

No test currently asserts on the `HY-{spec3}{seq}` shape as a hard contract — the tests exercise the selection/export *logic*, not the ID *format*. That's good news: adding a parallel SKU system needs zero test rewrites here, only new tests for the new pieces.

## 3. Current data inventory, legacy/unusual IDs, cross-table collision risk

All 147 real mother plants confirmed to date use the `HY-{spec3}{seq}` shape or an earlier, less consistent hand-typed variant (e.g. `HY-AH 01`, `HY-AH001`, `HY-AH201`, `HY-CV 01`, `HY-SS 01` — all pre-automation, `spec3` values with embedded spaces or digit suffixes that don't match the current deterministic derivation rule at all). These were never migrated to the current scheme and remain exactly as entered.

**Confirmed real embedded-space case**: `deriveSpec3(null, "AH Black Magic")` → `"AH "` (verified by executing the actual function this session, not inferred) → `buildMotherId("AH ", 5)` → `"HY-AH 05"`. This is why rule 7's "do not regex-reject" instruction is correct as written — a naive validator would reject real, valid, already-in-production data.

**Cross-table collision risk**: `mother_id` and `cutting_id` are each a `PRIMARY KEY` only within their own table — Postgres does not enforce uniqueness across the two. In practice, every `cutting_id` carries a `-C##` suffix that `buildMotherId` never produces on its own, so no real collision has occurred — but this is an emergent property of the two generator functions, not a schema-enforced guarantee. This applies to the *existing* ID scheme; the *new* SKU scheme (see §5) will get real, enforced global uniqueness via a database `UNIQUE` constraint, which the legacy scheme never had.

## 4. Proposed genus-code and plant-code registry schema

```sql
create table genus_codes (
  code        char(2) primary key,        -- e.g. 'HY', 'AL'
  genus_name  text not null unique,       -- e.g. 'Hoya', 'Alocasia'
  created_at  timestamptz not null default now()
);

create table plant_codes (
  id            bigint generated always as identity primary key,
  genus_code    char(2) not null references genus_codes(code),
  code          text not null check (code ~ '^[A-Z0-9]{3}$'),  -- e.g. 'KRQ', 'FRY'
  display_label text not null,   -- free-text identity description the operator
                                  -- assigned this code to (species, cultivar name,
                                  -- or a descriptive label for an unidentified plant)
  created_at    timestamptz not null default now(),
  unique (genus_code, code)
);
```

**Uniqueness scope — flagged as an owner decision (see §12):** I've scoped `plant_codes.code` unique *per genus* (`unique (genus_code, code)`), not globally, since the full SKU always prefixes with `GENUS-`, so `HY-KRQ-01` and `AL-KRQ-01` can never actually collide as full SKUs even if `KRQ` is reused across genera. This halves the registry-curation burden (a 3-character code space per genus, not shared across all genera). If you'd rather have `plant_codes.code` be globally unique regardless of genus (simpler mental model, more collision pressure on a small 3-character/36^3 space), that's a one-line constraint change — flagging it now rather than assuming.

Deliberately **no auto-generation function** for either code — matches rule 2/9 ("do not generate it blindly," "controlled registry," "manually resolved").

## 5. Proposed commerce-SKU allocation mechanism, with concurrency handling

```sql
create table commerce_skus (
  source_record_id   text primary key,        -- existing mother_id or cutting_id, UNCHANGED
  plant_record_type  text not null check (plant_record_type in ('mother', 'cutting')),
  sku                text not null unique,      -- the new standardized, immutable identifier
  assigned_at        timestamptz not null default now()
);

-- Per (genus_code, plant_code): atomic mother-sequence counter, same proven
-- pattern as next_mother_seq()/next_cutting_seq() already in this codebase.
create table commerce_mother_seq_counters (
  genus_code char(2) not null,
  plant_code text not null,
  next_seq   int not null default 1,
  primary key (genus_code, plant_code)
);

create or replace function next_commerce_mother_seq(p_genus char(2), p_plant text)
returns int language plpgsql as $$
declare v_seq int;
begin
  insert into commerce_mother_seq_counters (genus_code, plant_code, next_seq)
  values (p_genus, p_plant, 2)
  on conflict (genus_code, plant_code) do update
    set next_seq = commerce_mother_seq_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return v_seq;
end;
$$;

-- Per mother SKU: atomic cutting-sequence counter, restarts at C01 per mother.
create table commerce_cutting_seq_counters (
  mother_sku text primary key,
  next_seq   int not null default 1
);
-- next_commerce_cutting_seq(p_mother_sku) follows the identical pattern.
```

Concurrency handling is the exact same single-statement `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` pattern already proven and live in this codebase for `next_mother_seq`/`next_cutting_seq` — no new concurrency primitive needed, just the same shape applied to two more counters.

`commerce_skus.sku unique` is a real database constraint — unlike the legacy ID scheme, global SKU uniqueness (mothers and cuttings together) is actually enforced here, not just emergent.

## 6. Proposed legacy backfill/mapping plan

**Recommended: lazy, on-demand backfill — not a blanket upfront migration.** Assign a `commerce_skus` row the first time a record is selected for GM Commerce (see §7 for why that's the safest trigger point), not retroactively for all ~147+ existing mothers and their cuttings. Rationale:

- Rule 2 requires *deliberate*, human-reviewed genus/plant code assignment — that's real operator time, not a script. Forcing it for every historical record before shipping anything would mean curating dozens of plant-identity codes for plants that may never be sold, for no benefit.
- Nothing needs a SKU until it's actually offered for sale. `GET /api/commerce/v1/plants` only ever returns *selected* records — a record that's never been selected never needs to appear there, so it never needs a SKU.
- No legacy ID is touched either way (§ material-conflict check) — this plan only concerns the *new, additive* table.

**One real exception to flag:** at least one cutting (`HY-ICE01-C01`, seen in an earlier screenshot) is already selected/queued in the *current* (source-ID-only) commerce pipeline. Under the new scheme it would need its SKU assigned as part of rollout, not lazily, since it's already mid-flight. This is a small, explicit, bounded case — worth a one-time manual check of "what's currently selected but not yet acknowledged" before flipping the switch, not a general backfill.

No alias/mapping table beyond `commerce_skus` itself is needed — it already *is* the legacy-ID-to-SKU mapping (`source_record_id → sku`), serving double duty.

## 7. Should `sourceRecordId` and `sku` be separated without changing existing primary IDs?

**Yes, and — genuinely good news — the API response shape doesn't need to change at all to do it.** `CommercePlantRecord` (`lib/commerce-export.ts:37-52`) already has `sourceRecordId` and `sku` as two distinct fields; today they're just populated with the same value (`lib/commerce-export.ts:113-115`, `:131-133`). Separating them is a **behavior change in how `sku` gets populated** (look it up from `commerce_skus` instead of copying `sourceRecordId`), not a schema/contract change GM Commerce needs to adapt its *parsing* to — though per your mid-turn decision, GM Commerce does need to stop *assuming* the two are equal and must persist whatever `sku` it receives verbatim rather than deriving one.

**Recommended assignment trigger: at first commerce selection**, not at record creation. Reasons:
- Assigning a SKU (and its genus/plant registry lookup) at mother/cutting *creation* time would force every single new plant entry through the registry-curation step, even for the vast majority that are just inventory bookkeeping and never sold — real added friction to Crystal/Phil's daily entry workflow for no payoff.
- At *first selection* ("Select for GM Commerce"), the human is already in exactly the right context/intent (they're actively deciding to sell this specific plant) to also confirm/assign its genus+plant registry code, if not already set.
- This matches how `commerce_selected_at` itself already works — a deliberate, explicit human action, not an automatic side effect of creation.

## 8. How codes are assigned and collision-resolved in the UI

New, small admin screens (not existing today — closest current precedent is the `hoya_species` datalist feeding `MotherNamingFields.tsx`'s species autocomplete, which is a read-only reference list, not a registry with insert/collision-handling):

- **Genus Codes** screen: list existing `genus_codes` rows, a form to add a new genus name + 2-letter code. `UNIQUE` constraint on `genus_codes.genus_name` and on the primary key `code` itself — a collision (reusing a code, or re-adding an existing genus) fails at insert with a clear error surfaced in the UI ("Code already assigned to <genus>"), forcing the operator to pick differently, exactly matching rule 1's "assign another unused two-letter code manually."
- **Plant Codes** screen (or inline in the "Select for GM Commerce" flow itself, if that's the assignment trigger): pick a genus (dropdown sourced from `genus_codes`), then either pick an *existing* plant code for "this is another mother of an identity I've already coded" (search/autocomplete, reusing the same UI pattern as the existing species datalist), or create a new one with a fresh 3-character code + a free-text `display_label` describing the identity. `unique (genus_code, code)` constraint (per §4) surfaces the same kind of collision error.

## 9. How new genera and unidentified plants/hybrids receive controlled codes

**New genus**: an operator must add a row to `genus_codes` before anything of that genus can get a commerce SKU — deliberate gate, not automatic. (Skrybix's own `mother_plants.genus` column already defaults to `'Hoya'` but is free text — nothing currently stops entering `'Alocasia'` there today; the *commerce SKU* registry is what's new and gated.)

**Unidentified/hybrid plants**: no auto-derivation from any name field at all under the new scheme (unlike today's `deriveSpec3`, which *does* auto-slice). The operator manually creates or reuses a `plant_codes` entry with whatever `display_label` makes sense for that identity (e.g. an unidentified plant's collection descriptor) — conceptually similar to today's fallback-to-cultivar-text behavior, but now a deliberate registry lookup/insert instead of blind slicing, satisfying rule 2 directly.

## 10. Required API contract update for GM Commerce

**No JSON shape change.** `sourceRecordId` and `sku` already exist as separate fields. The only real requirement is behavioral, and it's on GM Commerce's side, not Skrybix's: **stop assuming `sourceRecordId === sku`, and persist the received `sku` value verbatim** rather than deriving or reconstructing it. I already flagged this exact point in the handoff doc sent earlier today (the "Identifier contract" section), just written *before* this SKU-separation decision existed — that doc will need a follow-up note once this ships (not done yet, since nothing is implemented — see Status above).

One clean property of the lazy-assignment design (§6/§7): since `GET /api/commerce/v1/plants` only ever returns *selected* records, and selection is the SKU-assignment trigger, **every record GM Commerce ever receives will already have a real, non-null `sku`** — no placeholder/null-sku case to handle on their end.

## 11. Required tests and migration/rollback strategy

**Tests needed** (none of this exists yet — genuinely new coverage, not modifying existing tests):
- `genus_codes`/`plant_codes` uniqueness constraints reject a duplicate code (DB-level, via a real insert-and-expect-error test, not just app-level validation).
- `next_commerce_mother_seq`/`next_commerce_cutting_seq` concurrency: mirror the existing `commerce-export.test.ts` style — call concurrently, assert no duplicate sequence numbers issued (there's no existing SQL-level concurrency test for `next_mother_seq`/`next_cutting_seq` either, worth noting as a gap in the *current* test suite too, not just the new one).
- SKU immutability: no code path updates `commerce_skus.sku` after insert (this can be a code-review/grep check like the ones in this report, or a real test asserting the function set never exposes an update path).
- Selection-triggers-SKU-assignment integration test: selecting a mother/cutting for commerce that has no `commerce_skus` row yet results in exactly one being created, with a valid, correctly-sequenced SKU.
- A record already selected before this ships (the `HY-ICE01-C01` case, §6) gets its SKU backfilled correctly by whatever one-time script/action handles that transition.

**Migration**: purely additive — three new tables (`genus_codes`, `plant_codes`, `commerce_skus`) plus two counter tables, zero changes to any existing table, zero changes to `mother_id`/`cutting_id` generation. This is materially the same low-risk shape as every other Supabase migration already shipped this session (new tables/columns via `create table if not exists`/`alter table ... add column if not exists`).

**Rollback**: trivial specifically because it's additive — drop the five new tables, revert `normalizeCuttingForCommerce`/`normalizeMotherForCommerce` to populate `sku` from `sourceRecordId` again (today's exact behavior). Nothing about `mother_plants`/`cuttings` themselves needs to be touched or reverted at any point in this whole feature, in either direction.

## 12. Owner decisions still required

1. **Plant-code uniqueness scope** (§4): per-genus (my recommendation) or global across all genera?
2. **SKU-assignment trigger** (§7): at first commerce selection (my recommendation) or at record creation?
3. **Genus codes for genera beyond Hoya/Alocasia**: the spec names Philodendron, Anthurium, Monstera, Dischidia as future genera but gives no codes for them. Per rule 1 ("controlled genus-code registry... assigned through," "not permanently hardcoded"), I'm treating this as **deliberately not mine to invent** — needs your explicit codes (or explicit approval of proposed ones) before those genera can ever get a commerce SKU. Not blocking Hoya/Alocasia work.
4. **The one already-selected legacy record** (`HY-ICE01-C01`, §6): confirm this is the only record needing SKU backfill as part of rollout, or if there are others already mid-pipeline I haven't seen.
5. **Mother-plant content semantics** (below): confirm whether Skrybix should start *capturing* these fields at all, and if so, which ones, and whether they're required-at-selection or optional.

---

## Mother-plant content-semantics gap inventory (requested separately)

I grepped the full schema, `lib/types.ts`, and everything under `app/mothers` for every field you listed. **None of them exist anywhere in Skrybix today — confirmed by search, zero matches, not inferred:**

| Fact | Exists in Skrybix? |
|---|---|
| Exact plant vs. representative plant | No |
| Pot size | No |
| Approximate plant/vine size | No |
| Rooted/established confirmation | No |
| Ships in pot vs. prepared another way | No |
| Quantity | No (mothers are always singular rows; there's no quantity concept for a mother the way `cuttings.qty`-adjacent logic exists in `outgoing_log.qty` for sold cuttings) |
| Condition/recent-cutback notes | No dedicated field — `mother_plants.notes` is a free-text column that *could* hold this informally today, but nothing structured, nothing GM-Commerce-exportable, and nothing that distinguishes "recent cutback" from any other kind of note |

**Per your explicit instruction, I have not invented defaults or synthetic values for any of these.** They are a genuine, confirmed data gap. Closing it (schema + entry-form fields + export) is separable work from the SKU standardization above — happy to scope it as its own design pass once you decide whether it's Skrybix's job to capture these or GM Commerce's job to collect them post-import.

---

## Implementation status (added 2026-08-13, after owner approval)

The design above was reviewed and approved with corrections (see the durable decision record in `CLAUDE.md`). Per that approval, the implementation was built and thoroughly tested — **but is deliberately not committed or pushed to this branch/PR**. Only this design report document is being pushed right now. Everything below describes what exists locally, pending your review before it goes anywhere near GitHub or production.

### What was built

- `genus_codes`, `plant_codes`, `commerce_skus` (surrogate PK + `unique (plant_record_type, source_record_id)` + `unique (sku)`, real FK columns to the registries — not a bare `source_record_id primary key` as originally drafted, per your correction), `mother_commerce_facts`, and two atomic sequence-counter tables — all in `supabase/schema.sql`.
- `select_mother_for_commerce()` / `select_cutting_for_commerce()` — one Postgres function body each (one transaction): SKU assignment, mother-fact recording (mother only), and marking the record selected either all commit or all roll back together. A cutting selection reserves its mother's SKU first without ever selecting/exporting the mother.
- A trigger makes `commerce_skus` rows fully immutable at the database level (any `UPDATE` is rejected outright), and real foreign keys from `commerce_skus` to `genus_codes`/`plant_codes` mean Postgres itself refuses to rename or delete a registry code that's already been used in an assigned SKU.
- `lib/commerce-export.ts` updated: `sku` is now looked up, never derived from `sourceRecordId`; `normalizeCuttingForCommerce`/`normalizeMotherForCommerce` fail closed (throw) rather than ever falling back to `sourceRecordId` as a placeholder SKU.
- Both API routes (`GET /api/commerce/v1/plants`, the acknowledge route) updated to resolve real SKUs. **JSON shape is unchanged** — `sourceRecordId` and `sku` were already separate fields.
- `app/mothers/actions.ts`/`app/cuttings/actions.ts`: `selectMotherForCommerce`/`selectCuttingForCommerce` now call the new RPCs and require genus/plant codes (+ facts for mothers) instead of being a bare checkbox.
- `components/CommerceSkuSelectionForm.tsx` (replacing the old `CommerceSelectionControl.tsx`): collects genus/plant code (pick existing or create new inline, mirroring the existing species-datalist pattern) and, for mothers only, the required sale facts. Cutting selection stays a code-only flow — no facts added there, per your instruction that cutting content stays distinct/unchanged.

### How it was verified (not just reasoned about)

A local Postgres 16 instance was actually stood up in this session and the full migration applied against real fixture data (including a mother ID with a genuine embedded space, `HY-AH 05`, matching real production data). Every scenario below was executed for real, with captured output, not assumed:

- Genus/plant code uniqueness rejected on duplicate.
- Invalid code shape (wrong length/case) rejected.
- Same 3-character plant code reused across two different genera: allowed (uniqueness is per-genus, per your decision).
- Two cuttings selected **concurrently** (real parallel processes, not sequential calls) from the same never-before-selected mother: exactly one mother SKU allocated, two distinct cutting sequences, mother's `commerce_selected_at` still `null` afterward.
- Two concurrent calls selecting the **same** mother: converge on exactly one `commerce_skus` row.
- `UPDATE`/`DELETE` against an in-use `commerce_skus`/`plant_codes`/`genus_codes` row: all rejected by the database itself.
- A mother selection missing a required fact (`pot_size`): rejected, and the SKU assignment that had already happened earlier in that same call was rolled back too — verified as zero leftover rows, not assumed from the function's structure.
- `sourceRecordId` (`HY-AH 05`, space preserved exactly) and `sku` (`HY-ABH-01`) demonstrably different values for the same record.

The exact commands are captured in `supabase/commerce_sku_tests.sql` (checked in, re-run against a second fresh database as a reproducibility check before this report was finalized — same results both times) and the JS-level pure-function tests are in `lib/commerce-export.test.ts` (6/6 passing: sourceRecordId≠sku, fail-closed on missing SKU, mixed mother/cutting export, genus/plant code validation).

### Legacy rollout — the one thing I genuinely cannot do myself

I have no credentialed access to the production Supabase database in this session. Before this ships, run this in the Supabase SQL editor and get me (or whoever reviews next) the actual result — I am not guessing or assuming `HY-ICE01-C01` is the only one:

```sql
select 'cutting' as plant_record_type, cutting_id as source_record_id, commerce_selected_at
from cuttings
where commerce_selected_at is not null and commerce_acknowledged_at is null
union all
select 'mother', mother_id, commerce_selected_at
from mother_plants
where commerce_selected_at is not null and commerce_acknowledged_at is null
order by commerce_selected_at;
```

Every row this returns needs a deliberately-assigned SKU (via `select_mother_for_commerce()`/`select_cutting_for_commerce()`, choosing real genus/plant codes for each) as part of rollout, before the new `sku`-resolution behavior goes live — otherwise those specific already-selected records would hit the fail-closed path (no resolvable SKU) the first time `GET /api/commerce/v1/plants` runs post-cutover.

### Explicitly not done in this pass

- **Not committed, not pushed, not deployed.** Per your latest message, only this design report is going to GitHub right now.
- GM Commerce itself: untouched, as instructed.
- Etsy: not activated, as instructed.
- Phase 2 batch processing: not started, as instructed.
- The checkbox/selection *model* itself wasn't changed beyond what's needed to collect the new required data for one record at a time — no batch-select, no bulk assignment tooling.
- Genus-code creation UI: deliberately not built this pass (only the two owner-approved codes, `HY`/`AL`, are seeded via migration). Per your instruction not to invent codes speculatively, adding a new genus for now means inserting directly into `genus_codes` (same pattern as every other one-off SQL change this session) until/unless a dedicated screen is actually requested.
