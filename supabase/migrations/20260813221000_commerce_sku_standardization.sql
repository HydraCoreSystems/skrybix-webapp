-- Forward migration for commerce SKU standardization.
--
-- This is the first file in supabase/migrations/ -- the repo's prior
-- convention was a single consolidated supabase/schema.sql applied
-- wholesale to a fresh database, with no forward-migration story for a
-- database that already has data in it. That convention breaks down
-- for this change specifically: it needs to run against the real,
-- already-populated production database, not just a fresh one, so it
-- gets a real timestamped migration file, matching the Supabase CLI's
-- standard supabase/migrations/<timestamp>_<name>.sql layout. Every
-- statement below is copied verbatim from supabase/schema.sql (which
-- remains the consolidated reference for a fresh database) and is
-- idempotent (create table if not exists / create or replace function),
-- so running this migration and then re-applying schema.sql is safe
-- either order, and running this migration twice is a no-op the second
-- time.
--
-- Apply with the Supabase CLI (`supabase db push`) or by hand via
-- `psql $DATABASE_URL -f supabase/migrations/20260813219000_commerce_sku_standardization.sql`.
-- See docs/Skrybix_Commerce_SKU_Design_Report.md for the deployment
-- order this fits into (schema first, then legacy-inventory SKU
-- backfill, then application code).

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
