-- Existing-ID-as-SKU correction -- forward migration.
--
-- Does NOT modify supabase/migrations/20260813221000_commerce_sku_standardization.sql,
-- which stays byte-identical to what was already applied to production.
-- This is a new, separate, additive migration on top of it.
--
-- OWNER DECISION: mother_id/cutting_id ARE the commerce/Shopify SKU,
-- byte-for-byte, always -- reversing the short-lived genus/plant-code
-- standardized-SKU design from the prior migration. See CLAUDE.md and
-- docs/Skrybix_Commerce_SKU_Design_Report.md for the full record, and
-- the GM Commerce compatibility gate this depended on (GM Commerce
-- PR #77, merge 0b75b39aa182ec224eb495f773c42e08a5ca85dc, post-merge
-- CI 31882818782, 25/25 passing).
--
-- Non-destructive: every table/function/trigger from the prior
-- migration (genus_codes, plant_codes, commerce_skus,
-- commerce_mother_seq_counters, commerce_cutting_seq_counters,
-- assign_commerce_sku_for_mother/cutting, next_commerce_mother_seq/
-- cutting_seq, forbid_commerce_sku_mutation + its triggers, and the
-- original 10-arg select_mother_for_commerce / 3-arg
-- select_cutting_for_commerce) is left fully in place. Only two new,
-- narrower overloads are added under the same function names --
-- Postgres treats a different argument list as a genuinely separate
-- function. EXECUTE on the old overloads is revoked from every role
-- including service_role, making them structurally inaccessible/
-- dormant rather than merely unused; EXECUTE on the new overloads is
-- granted only to service_role, matching the existing hardening
-- pattern. Idempotent -- safe to re-run.
--
-- Apply with the Supabase CLI (`supabase db push`) or by hand via
-- `psql $DATABASE_URL -f supabase/migrations/20260815120000_existing_id_as_commerce_sku.sql`,
-- AFTER 20260813221000_commerce_sku_standardization.sql has already
-- been applied (it depends on mother_commerce_facts and the mother/
-- cutting tables that migration/schema.sql create).

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
