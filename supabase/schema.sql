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
  flower_photo_link text
);

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
  created_at         timestamptz not null default now()
);

create index if not exists cuttings_active_idx on cuttings (mother_id) where archived_at is null;

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
