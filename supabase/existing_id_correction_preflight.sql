-- Existing-ID-as-SKU correction -- production preflight, READ-ONLY.
--
-- Every statement below is a SELECT against information_schema/pg_catalog
-- or the app's own tables -- no INSERT/UPDATE/DELETE/DDL, no RPC calls, no
-- transaction/session changes, no secrets. Safe to paste and run as one
-- query in the Supabase SQL editor.
--
-- This file is designed to be run safely at THREE separate points in the
-- existing-ID-as-SKU cutover, and to tell you which point you're at rather
-- than assuming one:
--
--   PRE-MIGRATION   (after 20260813221000_commerce_sku_standardization.sql
--                     only -- BEFORE 20260815120000 is applied). Expected:
--                     only the OLD signatures exist -- select_mother_for_
--                     commerce/10-arg and select_cutting_for_commerce/3-arg.
--                     The new 8-arg mother / 1-arg cutting overloads do not
--                     exist yet. This is the expected, healthy state for
--                     cutover step A (preflight before migrating) -- it
--                     must NOT be reported as an error just because the
--                     new signatures are absent.
--
--   POST-MIGRATION / PRE-APP-DEPLOY (immediately after 20260815120000 is
--                     applied, before the corrected application code is
--                     live). Expected: BOTH old and new signatures coexist.
--                     The old signatures have EXECUTE revoked from every
--                     role including service_role (owner-only). The new
--                     signatures have EXECUTE granted to service_role only
--                     (no anon, no authenticated, no PUBLIC).
--
--   POST-DEPLOYMENT  (after the corrected application code is live and
--                     serving traffic). Same database signature/grant
--                     state as POST-MIGRATION above -- this migration does
--                     not change again on deploy, so this run is a
--                     confirmation snapshot, not a new expected shape.
--
-- The phase_detection row below classifies the live signature/grant state
-- into exactly one of: pre_migration | post_migration |
-- unexpected_signature_state, so the same file can be run unmodified at
-- every step of the cutover procedure without manually re-deciding which
-- state is "expected" each time.

with commerce_sku_count (check_type, value, extra) as (
  select 'commerce_skus_row_count', count(*)::text, null::text
  from commerce_skus
),
plant_code_count (check_type, value, extra) as (
  select 'plant_codes_row_count', count(*)::text, null::text
  from plant_codes
),
pending_mothers (check_type, value, extra) as (
  select 'selected_unacknowledged_mothers', count(*)::text,
         nullif(string_agg(mother_id, ', ' order by mother_id), '')
  from mother_plants
  where commerce_selected_at is not null and commerce_acknowledged_at is null
),
pending_cuttings (check_type, value, extra) as (
  select 'selected_unacknowledged_cuttings', count(*)::text,
         nullif(string_agg(cutting_id, ', ' order by cutting_id), '')
  from cuttings
  where commerce_selected_at is not null and commerce_acknowledged_at is null
),
cross_type_collisions (check_type, value, extra) as (
  select 'cross_type_raw_id_collisions', count(*)::text,
         nullif(string_agg(m.mother_id || ' = ' || c.cutting_id, ', '), '')
  from mother_plants m
  join cuttings c on c.cutting_id = m.mother_id
),
whitespace_mothers (check_type, value, extra) as (
  select 'mother_ids_with_whitespace', count(*)::text,
         nullif(string_agg(mother_id, ', ' order by mother_id), '')
  from mother_plants
  where mother_id ~ '\s'
),
whitespace_cuttings (check_type, value, extra) as (
  select 'cutting_ids_with_whitespace', count(*)::text,
         nullif(string_agg(cutting_id, ', ' order by cutting_id), '')
  from cuttings
  where cutting_id ~ '\s'
),
rpc_signatures (check_type, value, extra) as (
  select
    'rpc_signature',
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    coalesce(
      (select string_agg(grantee::regrole::text, ',' order by grantee::regrole::text)
       from aclexplode(p.proacl) where privilege_type = 'EXECUTE'),
      '(no explicit grants -- owner only)'
    )
  from pg_proc p
  where p.proname in ('select_mother_for_commerce', 'select_cutting_for_commerce')
),
-- Phase detection: pure pg_catalog introspection, no RPC invocation. Reads
-- the same underlying facts as rpc_signatures above, just reshaped into a
-- single classification instead of one row per overload.
function_grants as (
  select
    p.proname,
    p.pronargs,
    coalesce(
      (select string_agg(grantee::regrole::text, ',' order by grantee::regrole::text)
       from aclexplode(p.proacl) where privilege_type = 'EXECUTE'),
      ''
    ) as grantees
  from pg_proc p
  where p.proname in ('select_mother_for_commerce', 'select_cutting_for_commerce')
),
-- "service_role only" below means only-among-PostgREST-facing-roles (anon,
-- authenticated, service_role) -- the schema owner (e.g. "postgres") is
-- expected to appear in the raw grantee list too once a function's ACL is
-- materialized by any GRANT/REVOKE, and that owner presence is not a
-- security concern; only an anon/authenticated grant on the new signatures
-- would be.
signature_flags as (
  select
    bool_or(proname = 'select_mother_for_commerce' and pronargs = 10) as old_mother_exists,
    bool_or(proname = 'select_cutting_for_commerce' and pronargs = 3) as old_cutting_exists,
    bool_or(proname = 'select_mother_for_commerce' and pronargs = 8) as new_mother_exists,
    bool_or(proname = 'select_cutting_for_commerce' and pronargs = 1) as new_cutting_exists,
    bool_or(proname = 'select_mother_for_commerce' and pronargs = 10
            and 'service_role' = any(string_to_array(grantees, ','))) as old_mother_service_role_grant,
    bool_or(proname = 'select_cutting_for_commerce' and pronargs = 3
            and 'service_role' = any(string_to_array(grantees, ','))) as old_cutting_service_role_grant,
    bool_or(proname = 'select_mother_for_commerce' and pronargs = 8
            and 'service_role' = any(string_to_array(grantees, ','))
            and not ('anon' = any(string_to_array(grantees, ',')))
            and not ('authenticated' = any(string_to_array(grantees, ',')))) as new_mother_service_role_only,
    bool_or(proname = 'select_cutting_for_commerce' and pronargs = 1
            and 'service_role' = any(string_to_array(grantees, ','))
            and not ('anon' = any(string_to_array(grantees, ',')))
            and not ('authenticated' = any(string_to_array(grantees, ',')))) as new_cutting_service_role_only,
    bool_or(pronargs not in (10, 3, 8, 1)) as unexpected_arity_present
  from function_grants
),
phase_detection (check_type, value, extra) as (
  select
    'phase_detection',
    case
      when not old_mother_exists or not old_cutting_exists then 'unexpected_signature_state'
      when unexpected_arity_present then 'unexpected_signature_state'
      when not new_mother_exists and not new_cutting_exists then 'pre_migration'
      when new_mother_exists and new_cutting_exists
           and not old_mother_service_role_grant and not old_cutting_service_role_grant
           and new_mother_service_role_only and new_cutting_service_role_only
        then 'post_migration'
      else 'unexpected_signature_state'
    end,
    case
      when not old_mother_exists or not old_cutting_exists
        then 'expected old signatures (select_mother_for_commerce/10-arg, select_cutting_for_commerce/3-arg) missing entirely -- schema drift, stop'
      when unexpected_arity_present
        then 'a select_mother_for_commerce/select_cutting_for_commerce overload exists with an arity other than 10, 3, 8, or 1 -- stop and investigate'
      when not new_mother_exists and not new_cutting_exists
        then 'only old signatures present, new signatures do not exist yet -- expected BEFORE 20260815120000_existing_id_as_commerce_sku.sql is applied (cutover step A)'
      when new_mother_exists and new_cutting_exists
           and not old_mother_service_role_grant and not old_cutting_service_role_grant
           and new_mother_service_role_only and new_cutting_service_role_only
        then 'old and new signatures coexist; old has no service_role grant; new is service_role-only -- expected AFTER 20260815120000_existing_id_as_commerce_sku.sql is applied (cutover steps B, F, and post-deployment)'
      else 'both old and new signatures exist but grants do not match either expected pre- or post-migration shape -- stop and investigate before proceeding'
    end
  from signature_flags
)

select check_type, value, extra from phase_detection
union all
select check_type, value, extra from commerce_sku_count
union all
select check_type, value, extra from plant_code_count
union all
select check_type, value, extra from pending_mothers
union all
select check_type, value, extra from pending_cuttings
union all
select check_type, value, extra from cross_type_collisions
union all
select check_type, value, extra from whitespace_mothers
union all
select check_type, value, extra from whitespace_cuttings
union all
select check_type, value, extra from rpc_signatures
order by check_type, value;
