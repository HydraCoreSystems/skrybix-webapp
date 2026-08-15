-- Skrybix schema
--
-- Ported from the live Google Sheet (Skrybix_FIXED_v2.gs / Mother_Plants /
-- Label_Data_Cuttings / Outgoing_Log / Hoya_Species / ID_Counters /
-- Archive_Cuttings), adapted to idiomatic Postgres rather than a literal
-- port of the Sheets architecture:
--
--   - ID_Counters -> mother_cutting_counters + next_cutting_seq(), an
--     atomic UPSERT instead of LockService + manual read/write. Same
--     guarantee (persistent, never-reused, collision-free per mother),
--     safer implementation.
--   - Archive_Cuttings -> cuttings.archived_at (soft-archive column)
--     instead of a second table + physical row move. Same guarantee
--     (archived rows drop out of "active" views, nothing is hard-deleted,
--     full row data preserved) via one WHERE clause instead of a copy+
--     delete.
--
-- Do not regenerate Cutting_ID/Mother_ID by scanning existing rows for a
-- max value — always go through next_cutting_seq(). See CLAUDE.md.

-- Columns below mix two generations of the real sheet's naming model:
-- qualifier/collection_code/trade_name/hybrid are the v2 columns from
-- Skrybix_FIXED_v2.gs, but as of the 2026-07-23 data migration every real
-- row's naming data actually lives in the OLDER form_code/name_type/
-- cultivar/natural_cultivar columns instead -- the v2 columns exist on the
-- live sheet but are unused (blank on all 995 rows). Kept both rather than
-- guessing which will end up authoritative once the naming-automation UI
-- gets built (see CLAUDE.md "Not yet built").
create table if not exists mother_plants (
  mother_id        text primary key,
  display_name     text not null,
  location         text,
  genus            text not null default 'Hoya',
  species          text,
  qualifier        text not null default '' check (qualifier in ('', 'aff.', 'cf.', 'sp.')),
  collection_code  text,
  cultivar         text,
  trade_name       text,
  hybrid           boolean not null default false,
  botanical_line1  text,
  botanical_line2  text,
  print_label      boolean not null default false,
  created_at       timestamptz not null default now(),
  -- real columns found on the live Mother_Plants tab, not in Skrybix_FIXED_v2.gs
  form_code        text,
  name_type        text,
  natural_cultivar boolean not null default false,
  spec3            text,
  mother_seq       text,
  notes            text,
  species_key      text,
  species_key_2    text,
  flower_photo_link text,
  scan_count       int not null default 0,
  -- Added 2026-08-13 so a whole mother plant (not just its cuttings) can
  -- be listed for sale through the GM Commerce handoff below -- mirrors
  -- cuttings.sold/commerce_selected_at/commerce_acknowledged_at. No
  -- archived_at here: there's no archive concept for a mother plant in
  -- this schema (only real deletion), so commerce records for mothers
  -- always report state as "active" or "sold", never "archived".
  sold                      boolean not null default false,
  commerce_selected_at      timestamptz,
  commerce_acknowledged_at  timestamptz
);

-- Safe to apply to the production table that existed before these
-- columns were introduced.
alter table mother_plants add column if not exists sold boolean not null default false;
alter table mother_plants add column if not exists commerce_selected_at timestamptz;
alter table mother_plants add column if not exists commerce_acknowledged_at timestamptz;

create index if not exists mother_plants_commerce_selected_idx
  on mother_plants (mother_id)
  where commerce_selected_at is not null and commerce_acknowledged_at is null;

-- Persistent, never-reused Mother_ID sequence counter, one row per
-- 3-letter code (`spec3`). Mirrors the real live-sheet convention
-- (confirmed against actual production Mother_Plants rows, not guessed):
-- Mother_ID = "HY-" + spec3 + zero-padded 2-digit sequence, e.g.
-- "HY-ELL01" or, when the identifying text's 3rd character is a space,
-- "HY-AH 01". spec3 is the first 3 characters (uppercased, NOT trimmed)
-- of the species name when one is recorded, otherwise of the
-- cultivar/descriptor text -- see lib/mother-id.ts. Never regenerate by
-- scanning mother_plants for a max value; always go through
-- next_mother_seq(), same rule as next_cutting_seq() below.
create table if not exists mother_id_counters (
  spec3    text primary key,
  next_seq int not null default 1
);

-- Atomically reserves the next sequence number for a spec3 code.
create or replace function next_mother_seq(p_spec3 text)
returns int
language plpgsql
as $$
declare
  v_seq int;
begin
  insert into mother_id_counters (spec3, next_seq)
  values (p_spec3, 2)
  on conflict (spec3) do update
    set next_seq = mother_id_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return v_seq;
end;
$$;

-- Persistent, never-reused per-mother cutting sequence counter.
create table if not exists mother_cutting_counters (
  mother_id text primary key references mother_plants(mother_id),
  next_seq  int not null default 1
);

-- Atomically reserves `p_count` sequential numbers for a mother and
-- returns the first one, e.g. next_cutting_seq('M014', 3) issuing 5,6,7
-- returns 5. Safe under concurrent callers (single UPSERT, row-locked).
create or replace function next_cutting_seq(p_mother_id text, p_count int)
returns int
language plpgsql
as $$
declare
  v_start int;
begin
  insert into mother_cutting_counters (mother_id, next_seq)
  values (p_mother_id, 1 + p_count)
  on conflict (mother_id) do update
    set next_seq = mother_cutting_counters.next_seq + p_count
  returning next_seq - p_count into v_start;
  return v_start;
end;
$$;

create table if not exists cuttings (
  cutting_id         text primary key,
  mother_id          text not null references mother_plants(mother_id),
  full_display_name  text,
  label_line1        text,
  label_line2        text,
  date_taken         date,
  sold               boolean not null default false,
  print_label        boolean not null default false,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  scan_count         int not null default 0,
  commerce_selected_at    timestamptz,
  commerce_acknowledged_at timestamptz
);

-- These ALTER statements make the selection handoff safe to apply to the
-- production table that existed before these columns were introduced.
alter table cuttings add column if not exists commerce_selected_at timestamptz;
alter table cuttings add column if not exists commerce_acknowledged_at timestamptz;

create index if not exists cuttings_active_idx on cuttings (mother_id) where archived_at is null;
create index if not exists cuttings_commerce_selected_idx
  on cuttings (cutting_id)
  where commerce_selected_at is not null and commerce_acknowledged_at is null;

-- QR-scan tracking: a page load on a public /plant/** page is a very
-- reliable stand-in for "someone scanned this" since those URLs aren't
-- linked anywhere else or guessable -- not a literal scan-event log, just
-- a simple running total per the owner's request. Atomic UPDATE, not a
-- read-then-write, so concurrent scans can't clobber each other.
create or replace function increment_mother_scan_count(p_mother_id text)
returns void
language sql
as $$
  update mother_plants set scan_count = scan_count + 1 where mother_id = p_mother_id;
$$;

create or replace function increment_cutting_scan_count(p_cutting_id text)
returns void
language sql
as $$
  update cuttings set scan_count = scan_count + 1 where cutting_id = p_cutting_id;
$$;

create table if not exists outgoing_log (
  id                 bigint generated always as identity primary key,
  date_out           date not null default current_date,
  cutting_id         text not null references cuttings(cutting_id),
  full_display_name  text,
  qty                int not null default 1,
  reason             text,
  selling_platform   text,
  notes              text,
  created_at         timestamptz not null default now()
);

-- Species reference/checklist (Kew POWO, 563 rows in the live Sheet).
-- Schema only for now — data import + naming-automation UI are separate,
-- not-yet-scoped decisions. In_Collection must never auto-unmark once
-- true (it's "have I ever owned this," not a live count) — enforce that
-- in application code, not here.
create table if not exists hoya_species (
  id               bigint generated always as identity primary key,
  genus            text not null default 'Hoya',
  species          text not null,
  in_collection    boolean not null default false,
  date_added       date,
  preferred_id_code text,
  native_range     text,
  region_group     text,
  growth_habit     text,
  leaf_notes       text,
  bloom_notes      text,
  authority        text,
  notes            text,
  source           text,
  unique_id        text
);

create unique index if not exists hoya_species_species_idx on hoya_species (lower(species));

-- Single shared site password, hashed (bcrypt), for the login page in
-- app/login. Singleton row (id always 1) -- this is a pragmatic first
-- step, not real multi-user accounts. See CLAUDE.md's auth section for
-- the eventual direction (individual sign-ons).
create table if not exists site_auth (
  id            int primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at    timestamptz not null default now()
);
-- Commerce SKU standardization -- added 2026-08-13, owner-approved
-- architecture (see docs/Skrybix_Commerce_SKU_Design_Report.md and the
-- decision record in CLAUDE.md).
--
-- CRITICAL, non-negotiable constraint this whole section is built
-- around: mother_plants.mother_id and cuttings.cutting_id are NEVER
-- touched by anything below. Mother QR codes are printed with the
-- literal current mother_id baked into the image on physical labels
-- already in circulation -- changing that value would 404 every
-- already-printed QR code with no way to reissue history. The
-- standardized commerce SKU is a wholly separate, additive concept,
-- looked up by (plant_record_type, source_record_id), never a
-- replacement for the existing primary keys.

-- ---------------------------------------------------------------
-- Registries -- deliberately no auto-generation function for either.
-- Codes are assigned by a human, once, through these tables only.
-- ---------------------------------------------------------------

create table if not exists genus_codes (
  code        char(2) primary key check (code = upper(code)),
  genus_name  text not null unique,
  created_at  timestamptz not null default now()
);

-- Owner-approved initial codes (2026-08-13). Do not add further genus
-- codes speculatively -- add them deliberately when first needed.
insert into genus_codes (code, genus_name) values
  ('HY', 'Hoya'),
  ('AL', 'Alocasia')
on conflict (code) do nothing;

create table if not exists plant_codes (
  id            bigint generated always as identity primary key,
  genus_code    char(2) not null references genus_codes(code),
  code          text not null check (code = upper(code) and code ~ '^[A-Z0-9]{3}$'),
  display_label text not null,
  created_at    timestamptz not null default now(),
  unique (genus_code, code)
);

-- ---------------------------------------------------------------
-- The commerce SKU mapping itself.
--
-- Deliberately NOT keyed solely on source_record_id (mother_id and
-- cutting_id are each only unique within their own table, not across
-- both -- see the design report's collision-risk section). The real
-- identity is the pair (plant_record_type, source_record_id).
--
-- genus_code/plant_code are stored as real FK columns (not just baked
-- into the sku string) specifically so a registry code that's already
-- been used can never be renamed or deleted out from under an assigned
-- SKU -- Postgres enforces that automatically once a FK reference
-- exists, no extra trigger needed for that part.
-- ---------------------------------------------------------------

create table if not exists commerce_skus (
  id                bigint generated always as identity primary key,
  plant_record_type text not null check (plant_record_type in ('mother', 'cutting')),
  source_record_id  text not null,
  genus_code        char(2) not null references genus_codes(code),
  plant_code        text not null,
  mother_seq        int not null,
  cutting_seq       int,
  sku               text not null unique,
  assigned_at       timestamptz not null default now(),
  unique (plant_record_type, source_record_id),
  foreign key (genus_code, plant_code) references plant_codes (genus_code, code),
  check (
    (plant_record_type = 'mother' and cutting_seq is null) or
    (plant_record_type = 'cutting' and cutting_seq is not null)
  )
);

-- Database-enforced immutability: once a row exists, it can never be
-- changed OR removed, only inserted. This is deliberately NOT relying on
-- "no application code happens to touch it" -- the DB itself refuses,
-- for both UPDATE and DELETE (a delete-then-reinsert would otherwise be
-- an easy way to silently "reassign" a SKU that already left this
-- system in an export). `set search_path` pins name resolution for this
-- and every other new function below, closing the standard Postgres
-- search-path-hijack risk for SECURITY DEFINER-adjacent plpgsql code.
create or replace function forbid_commerce_sku_mutation()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'commerce_skus rows are immutable and cannot be updated or deleted (id=%)', coalesce(old.id, new.id);
end;
$$;

drop trigger if exists commerce_skus_no_update on commerce_skus;
create trigger commerce_skus_no_update
  before update on commerce_skus
  for each row execute function forbid_commerce_sku_mutation();

drop trigger if exists commerce_skus_no_delete on commerce_skus;
create trigger commerce_skus_no_delete
  before delete on commerce_skus
  for each row execute function forbid_commerce_sku_mutation();

-- ---------------------------------------------------------------
-- Atomic sequence counters -- identical pattern to the already-proven
-- next_mother_seq()/next_cutting_seq() elsewhere in this schema.
-- ---------------------------------------------------------------

create table if not exists commerce_mother_seq_counters (
  genus_code char(2) not null,
  plant_code text not null,
  next_seq   int not null default 1,
  primary key (genus_code, plant_code)
);

create or replace function next_commerce_mother_seq(p_genus_code char(2), p_plant_code text)
returns int language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_seq int;
begin
  insert into commerce_mother_seq_counters (genus_code, plant_code, next_seq)
  values (p_genus_code, p_plant_code, 2)
  on conflict (genus_code, plant_code) do update
    set next_seq = commerce_mother_seq_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return v_seq;
end;
$$;

create table if not exists commerce_cutting_seq_counters (
  mother_sku text primary key,
  next_seq   int not null default 1
);

create or replace function next_commerce_cutting_seq(p_mother_sku text)
returns int language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_seq int;
begin
  insert into commerce_cutting_seq_counters (mother_sku, next_seq)
  values (p_mother_sku, 2)
  on conflict (mother_sku) do update
    set next_seq = commerce_cutting_seq_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return v_seq;
end;
$$;

-- ---------------------------------------------------------------
-- Atomic SKU assignment. Each function is idempotent (safe to call
-- again for an already-assigned record -- returns the existing SKU
-- without allocating a new sequence number) and runs as a single
-- Postgres function body, which is implicitly one transaction: the
-- sequence reservation and the commerce_skus insert either both
-- commit or both roll back together.
--
-- Known, accepted trade-off (documented, not hidden): under a genuine
-- concurrent race where two callers both pass the "not yet assigned"
-- check before either inserts, both will reserve a real sequence
-- number via next_commerce_mother_seq/next_commerce_cutting_seq, but
-- only one insert wins (the loser's ON CONFLICT DO NOTHING skips its
-- insert) -- the loser's reserved number is simply never used again.
-- This can produce small gaps in the sequence under real concurrency,
-- never a duplicate or incorrect SKU. This is the exact same
-- trade-off already accepted by the pre-existing next_mother_seq()/
-- next_cutting_seq() functions elsewhere in this schema -- not a new
-- risk introduced here, and consistent with "may exceed 99" already
-- tolerating non-contiguous growth.
-- ---------------------------------------------------------------

create or replace function assign_commerce_sku_for_mother(
  p_source_record_id text,
  p_genus_code char(2),
  p_plant_code text
)
returns text language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sku text;
  v_existing_genus char(2);
  v_existing_plant text;
  v_seq int;
begin
  if not exists (select 1 from mother_plants where mother_id = p_source_record_id) then
    raise exception 'Cannot assign a commerce SKU: mother % does not exist.', p_source_record_id;
  end if;

  select sku, genus_code, plant_code into v_sku, v_existing_genus, v_existing_plant
    from commerce_skus
    where plant_record_type = 'mother' and source_record_id = p_source_record_id;
  if v_sku is not null then
    if v_existing_genus <> p_genus_code or v_existing_plant <> p_plant_code then
      raise exception 'Mother % already has commerce SKU % assigned under %-% -- cannot reassign to %-% (SKUs are immutable).',
        p_source_record_id, v_sku, v_existing_genus, v_existing_plant, p_genus_code, p_plant_code;
    end if;
    return v_sku;
  end if;

  v_seq := next_commerce_mother_seq(p_genus_code, p_plant_code);
  v_sku := p_genus_code || '-' || p_plant_code || '-' || lpad(v_seq::text, 2, '0');

  insert into commerce_skus (plant_record_type, source_record_id, genus_code, plant_code, mother_seq, sku)
  values ('mother', p_source_record_id, p_genus_code, p_plant_code, v_seq, v_sku)
  on conflict (plant_record_type, source_record_id) do nothing;

  if not found then
    select sku into v_sku from commerce_skus
      where plant_record_type = 'mother' and source_record_id = p_source_record_id;
  end if;

  return v_sku;
end;
$$;

-- Reserves (never selects/exports) the mother's own commerce SKU
-- first, then allocates the cutting's sequence from it. A cutting can
-- never receive a commerce SKU whose mother doesn't already have one.
-- This function ONLY inserts into commerce_skus -- it never touches
-- mother_plants.commerce_selected_at/commerce_acknowledged_at, so
-- reserving a mother SKU as a side effect of selecting one of its
-- cuttings can never mark that mother selected or exported.
--
-- The mother is DERIVED from cuttings.mother_id inside this function,
-- never trusted from a caller-supplied parameter -- a caller (browser
-- action) cannot fabricate a commerce_skus mapping for a cutting under
-- a mother it doesn't actually belong to.
create or replace function assign_commerce_sku_for_cutting(
  p_source_record_id text,
  p_genus_code char(2),
  p_plant_code text
)
returns text language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sku text;
  v_existing_genus char(2);
  v_existing_plant text;
  v_mother_id text;
  v_mother_sku text;
  v_seq int;
begin
  select sku, genus_code, plant_code into v_sku, v_existing_genus, v_existing_plant
    from commerce_skus
    where plant_record_type = 'cutting' and source_record_id = p_source_record_id;
  if v_sku is not null then
    if v_existing_genus <> p_genus_code or v_existing_plant <> p_plant_code then
      raise exception 'Cutting % already has commerce SKU % assigned under %-% -- cannot reassign to %-% (SKUs are immutable).',
        p_source_record_id, v_sku, v_existing_genus, v_existing_plant, p_genus_code, p_plant_code;
    end if;
    return v_sku;
  end if;

  select mother_id into v_mother_id from cuttings where cutting_id = p_source_record_id;
  if v_mother_id is null then
    raise exception 'Cannot assign a commerce SKU: cutting % does not exist.', p_source_record_id;
  end if;

  v_mother_sku := assign_commerce_sku_for_mother(v_mother_id, p_genus_code, p_plant_code);

  v_seq := next_commerce_cutting_seq(v_mother_sku);
  v_sku := v_mother_sku || '-C' || lpad(v_seq::text, 2, '0');

  insert into commerce_skus (plant_record_type, source_record_id, genus_code, plant_code, mother_seq, cutting_seq, sku)
  select 'cutting', p_source_record_id, p_genus_code, p_plant_code, m.mother_seq, v_seq, v_sku
  from commerce_skus m
  where m.plant_record_type = 'mother' and m.source_record_id = v_mother_id
  on conflict (plant_record_type, source_record_id) do nothing;

  if not found then
    select sku into v_sku from commerce_skus
      where plant_record_type = 'cutting' and source_record_id = p_source_record_id;
  end if;

  return v_sku;
end;
$$;

-- ---------------------------------------------------------------
-- Mother-commerce facts -- required structured data at first mother
-- selection (see design report §8 / CLAUDE.md decision record).
-- Deliberately NOT inferred from plantRecordType="mother" and NOT
-- read from the general notes field -- this is its own table, with
-- its own required columns, populated only by an explicit human
-- action at selection time.
-- ---------------------------------------------------------------

create table if not exists mother_commerce_facts (
  source_record_id             text primary key references mother_plants(mother_id),
  photo_subject                text not null check (photo_subject in ('exact_plant', 'representative_plant')),
  pot_size                     text not null,
  plant_size                   text not null,
  rooted_established           boolean not null,
  shipping_presentation        text not null check (shipping_presentation in ('ships_in_pot', 'prepared_other')),
  shipping_presentation_detail text,
  condition_notes               text,
  -- A selected mother record represents exactly one whole plant.
  -- Locked to 1 at the database level, not just convention -- revisit
  -- only if Phil later approves a different model (see design report).
  quantity                     int not null default 1 check (quantity = 1),
  recorded_at                  timestamptz not null default now(),
  -- Enforced at the database boundary, not just in the Server Action/UI --
  -- a "prepared another way" shipping presentation without a detail
  -- string is meaningless data, and this must be true no matter what
  -- inserts the row.
  check (
    shipping_presentation <> 'prepared_other' or coalesce(trim(shipping_presentation_detail), '') <> ''
  )
);

-- ---------------------------------------------------------------
-- Top-level selection entry points -- each runs as ONE Postgres
-- function body (one transaction): SKU assignment, mother-fact
-- recording, and marking the record selected either all commit or
-- all roll back together. No multi-round-trip orchestration from the
-- application layer for this -- that's what "atomicity" requires here.
-- ---------------------------------------------------------------

create or replace function select_mother_for_commerce(
  p_mother_id text,
  p_genus_code char(2),
  p_plant_code text,
  p_photo_subject text,
  p_pot_size text,
  p_plant_size text,
  p_rooted_established boolean,
  p_shipping_presentation text,
  p_shipping_presentation_detail text,
  p_condition_notes text
)
returns text language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sku text;
  v_updated int;
begin
  if not exists (select 1 from mother_plants where mother_id = p_mother_id) then
    raise exception 'Cannot select mother % for commerce: it does not exist.', p_mother_id;
  end if;

  v_sku := assign_commerce_sku_for_mother(p_mother_id, p_genus_code, p_plant_code);

  insert into mother_commerce_facts (
    source_record_id, photo_subject, pot_size, plant_size, rooted_established,
    shipping_presentation, shipping_presentation_detail, condition_notes
  )
  values (
    p_mother_id, p_photo_subject, p_pot_size, p_plant_size, p_rooted_established,
    p_shipping_presentation, p_shipping_presentation_detail, p_condition_notes
  )
  on conflict (source_record_id) do nothing;

  update mother_plants
    set commerce_selected_at = now()
    where mother_id = p_mother_id and commerce_selected_at is null;
  get diagnostics v_updated = row_count;

  -- v_updated = 0 is fine if it's because this mother was ALREADY
  -- selected (idempotent re-call) -- only a genuine failure to ever mark
  -- it selected should fail closed here.
  if v_updated = 0 and not exists (
    select 1 from mother_plants where mother_id = p_mother_id and commerce_selected_at is not null
  ) then
    raise exception 'Failed to mark mother % selected for commerce.', p_mother_id;
  end if;

  return v_sku;
end;
$$;

-- p_mother_id is deliberately NOT a parameter here -- see
-- assign_commerce_sku_for_cutting's comment on why the mother is always
-- derived from cuttings.mother_id in the database, never trusted from
-- the caller.
create or replace function select_cutting_for_commerce(
  p_cutting_id text,
  p_genus_code char(2),
  p_plant_code text
)
returns text language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sku text;
  v_updated int;
begin
  if not exists (select 1 from cuttings where cutting_id = p_cutting_id) then
    raise exception 'Cannot select cutting % for commerce: it does not exist.', p_cutting_id;
  end if;

  v_sku := assign_commerce_sku_for_cutting(p_cutting_id, p_genus_code, p_plant_code);

  update cuttings
    set commerce_selected_at = now()
    where cutting_id = p_cutting_id and commerce_selected_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 and not exists (
    select 1 from cuttings where cutting_id = p_cutting_id and commerce_selected_at is not null
  ) then
    raise exception 'Failed to mark cutting % selected for commerce.', p_cutting_id;
  end if;

  return v_sku;
end;
$$;

-- ---------------------------------------------------------------
-- Access hardening for the new commerce SKU objects.
--
-- This app never sends a Supabase anon/publishable key to the browser --
-- there is no NEXT_PUBLIC_SUPABASE_* anything anywhere in this repo;
-- every access goes through getSupabaseServerClient() (lib/supabase.ts),
-- which always uses the service role key. But a Supabase project
-- provisions every table/function in `public` with default privileges
-- that grant access to the `anon`/`authenticated` roles too (via
-- `ALTER DEFAULT PRIVILEGES ... GRANT ... TO anon, authenticated,
-- service_role`, set up at project creation), and PostgREST
-- auto-exposes every public table and function as a REST/RPC endpoint
-- unless that access is explicitly closed off -- independent of whether
-- this app's own code ever hands out a key that uses those roles.
-- Verified locally, with Supabase's real default grants reproduced: the
-- `anon` role could read `commerce_skus`, insert directly into
-- `genus_codes`, and invoke `select_mother_for_commerce()` -- all
-- without touching this app's code or its service-role key.
--
-- The rest of this schema (mother_plants, cuttings, etc.) has the same
-- exposure and predates this PR -- that is a real, separate, wider gap,
-- worth its own repo-wide hardening pass, not something to silently
-- absorb into this one. This block closes it only for the objects this
-- PR actually introduces: RLS enabled with zero policies (default-deny
-- for every role except service_role, which bypasses RLS
-- unconditionally by Postgres/Supabase design, regardless of policies)
-- on every new table, and EXECUTE revoked from PUBLIC/anon/authenticated
-- on every new function, re-granted only to service_role. Guarded so
-- this still applies cleanly to a bare local/dev Postgres that has none
-- of Supabase's roles.
-- ---------------------------------------------------------------

alter table genus_codes enable row level security;
alter table plant_codes enable row level security;
alter table commerce_skus enable row level security;
alter table commerce_mother_seq_counters enable row level security;
alter table commerce_cutting_seq_counters enable row level security;
alter table mother_commerce_facts enable row level security;

revoke execute on function next_commerce_mother_seq(character, text) from public;
revoke execute on function next_commerce_cutting_seq(text) from public;
revoke execute on function assign_commerce_sku_for_mother(text, character, text) from public;
revoke execute on function assign_commerce_sku_for_cutting(text, character, text) from public;
revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from public;
revoke execute on function select_cutting_for_commerce(text, character, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on genus_codes, plant_codes, commerce_skus,
      commerce_mother_seq_counters, commerce_cutting_seq_counters,
      mother_commerce_facts from anon;
    revoke execute on function next_commerce_mother_seq(character, text) from anon;
    revoke execute on function next_commerce_cutting_seq(text) from anon;
    revoke execute on function assign_commerce_sku_for_mother(text, character, text) from anon;
    revoke execute on function assign_commerce_sku_for_cutting(text, character, text) from anon;
    revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from anon;
    revoke execute on function select_cutting_for_commerce(text, character, text) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on genus_codes, plant_codes, commerce_skus,
      commerce_mother_seq_counters, commerce_cutting_seq_counters,
      mother_commerce_facts from authenticated;
    revoke execute on function next_commerce_mother_seq(character, text) from authenticated;
    revoke execute on function next_commerce_cutting_seq(text) from authenticated;
    revoke execute on function assign_commerce_sku_for_mother(text, character, text) from authenticated;
    revoke execute on function assign_commerce_sku_for_cutting(text, character, text) from authenticated;
    revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from authenticated;
    revoke execute on function select_cutting_for_commerce(text, character, text) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function next_commerce_mother_seq(character, text) to service_role;
    grant execute on function next_commerce_cutting_seq(text) to service_role;
    grant execute on function assign_commerce_sku_for_mother(text, character, text) to service_role;
    grant execute on function assign_commerce_sku_for_cutting(text, character, text) to service_role;
    grant execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) to service_role;
    grant execute on function select_cutting_for_commerce(text, character, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Existing-ID-as-SKU correction (forward migration -- does not modify
-- anything above; the previously-applied migration file stays
-- byte-identical). OWNER DECISION: mother_id/cutting_id ARE the
-- commerce/Shopify SKU, byte-for-byte, always -- no separate genus/
-- plant-code SKU is generated anymore. See CLAUDE.md and
-- docs/Skrybix_Commerce_SKU_Design_Report.md for the full record and
-- the GM Commerce compatibility gate this depended on (PR #77,
-- merge 0b75b39aa182ec224eb495f773c42e08a5ca85dc).
--
-- Non-destructive by design: the original 10-arg select_mother_for_commerce
-- and 3-arg select_cutting_for_commerce signatures above, and every
-- table/function they depend on (genus_codes, plant_codes, commerce_skus,
-- commerce_mother_seq_counters, commerce_cutting_seq_counters,
-- assign_commerce_sku_for_mother/cutting, next_commerce_mother_seq/
-- cutting_seq, forbid_commerce_sku_mutation + its triggers) are left
-- fully in place -- not dropped, not altered, not cleaned up. Only two
-- NEW, narrower overloads are added under the SAME function names
-- (select_mother_for_commerce, select_cutting_for_commerce) -- Postgres
-- distinguishes overloads by argument list, so a different parameter
-- count is a genuinely separate function that coexists with the old
-- one at the database level. EXECUTE on the old signatures is revoked
-- from every role, including service_role, so the app's own access
-- path can no longer reach them either -- they become inaccessible/
-- dormant, not merely unused. EXECUTE on the new signatures is granted
-- only to service_role, matching the access-hardening pattern above.
--
-- Residual risk, flagged rather than assumed away: PostgREST's RPC
-- overload resolution (matching the caller's supplied argument names
-- against each candidate function's declared parameter names) has not
-- been exercised against a live PostgREST instance in this session --
-- only proven at the raw Postgres level, where both overloads coexist
-- and calling with the new, smaller argument set unambiguously resolves
-- to the new function (the old overload requires additional non-null
-- arguments this call never supplies). This is the documented,
-- supported PostgREST behavior for overloaded functions, but treat live
-- verification against the real Supabase project as a required
-- pre-deployment step, not something this migration proves on its own.
-- ---------------------------------------------------------------

create or replace function select_mother_for_commerce(
  p_mother_id text,
  p_photo_subject text,
  p_pot_size text,
  p_plant_size text,
  p_rooted_established boolean,
  p_shipping_presentation text,
  p_shipping_presentation_detail text,
  p_condition_notes text
)
returns text language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if not exists (select 1 from mother_plants where mother_id = p_mother_id) then
    raise exception 'Cannot select mother % for commerce: it does not exist.', p_mother_id;
  end if;

  insert into mother_commerce_facts (
    source_record_id, photo_subject, pot_size, plant_size, rooted_established,
    shipping_presentation, shipping_presentation_detail, condition_notes
  )
  values (
    p_mother_id, p_photo_subject, p_pot_size, p_plant_size, p_rooted_established,
    p_shipping_presentation, p_shipping_presentation_detail, p_condition_notes
  )
  on conflict (source_record_id) do nothing;

  update mother_plants
    set commerce_selected_at = now()
    where mother_id = p_mother_id and commerce_selected_at is null;
  get diagnostics v_updated = row_count;

  -- v_updated = 0 is fine if it's because this mother was ALREADY
  -- selected (idempotent re-call) -- only a genuine failure to ever mark
  -- it selected should fail closed here. A failed facts insert (e.g. a
  -- NOT NULL violation) raises before this point is ever reached, and
  -- the whole function body is one transaction, so the facts insert
  -- above rolls back too -- no partial state either way.
  if v_updated = 0 and not exists (
    select 1 from mother_plants where mother_id = p_mother_id and commerce_selected_at is not null
  ) then
    raise exception 'Failed to mark mother % selected for commerce.', p_mother_id;
  end if;

  return p_mother_id;
end;
$$;

-- Deliberately no genus/plant-code parameters, no mother-reservation
-- concept: since sku === cutting_id always, there is nothing to reserve
-- or derive for the mother. This function touches only the `cuttings`
-- row named by p_cutting_id -- it is structurally impossible for it to
-- select or export the cutting's mother as a side effect, since it
-- never queries or updates mother_plants at all.
create or replace function select_cutting_for_commerce(
  p_cutting_id text
)
returns text language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if not exists (select 1 from cuttings where cutting_id = p_cutting_id) then
    raise exception 'Cannot select cutting % for commerce: it does not exist.', p_cutting_id;
  end if;

  update cuttings
    set commerce_selected_at = now()
    where cutting_id = p_cutting_id and commerce_selected_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 and not exists (
    select 1 from cuttings where cutting_id = p_cutting_id and commerce_selected_at is not null
  ) then
    raise exception 'Failed to mark cutting % selected for commerce.', p_cutting_id;
  end if;

  return p_cutting_id;
end;
$$;

-- Both the OLD (obsolete) and the NEW (corrected) overloads get their
-- PUBLIC execute revoked -- a fresh CREATE FUNCTION always grants EXECUTE
-- to PUBLIC by default, and the new overloads created just above are no
-- exception. Revoking only the old ones and assuming the new ones were
-- "clean" was tried first in this session and caught by direct testing:
-- the anon role could still execute the new 1-arg
-- select_cutting_for_commerce() because Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE to anon/authenticated/service_role on every
-- newly created function automatically, independent of PUBLIC. Every
-- role below is revoked from BOTH signatures, then the new ones alone
-- are re-granted to service_role.
revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from public;
revoke execute on function select_cutting_for_commerce(text, character, text) from public;
revoke execute on function select_mother_for_commerce(text, text, text, text, boolean, text, text, text) from public;
revoke execute on function select_cutting_for_commerce(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from anon;
    revoke execute on function select_cutting_for_commerce(text, character, text) from anon;
    revoke execute on function select_mother_for_commerce(text, text, text, text, boolean, text, text, text) from anon;
    revoke execute on function select_cutting_for_commerce(text) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from authenticated;
    revoke execute on function select_cutting_for_commerce(text, character, text) from authenticated;
    revoke execute on function select_mother_for_commerce(text, text, text, text, boolean, text, text, text) from authenticated;
    revoke execute on function select_cutting_for_commerce(text) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Old, obsolete overloads: revoked from service_role too, so the
    -- app's own real access path can no longer reach them -- genuinely
    -- dormant, not just unused by convention.
    revoke execute on function select_mother_for_commerce(text, character, text, text, text, text, boolean, text, text, text) from service_role;
    revoke execute on function select_cutting_for_commerce(text, character, text) from service_role;

    -- New, corrected overloads: revoke the auto-granted default first,
    -- then grant explicitly -- the only ones the app calls going forward.
    revoke execute on function select_mother_for_commerce(text, text, text, text, boolean, text, text, text) from service_role;
    revoke execute on function select_cutting_for_commerce(text) from service_role;
    grant execute on function select_mother_for_commerce(text, text, text, text, boolean, text, text, text) to service_role;
    grant execute on function select_cutting_for_commerce(text) to service_role;
  end if;
end $$;

