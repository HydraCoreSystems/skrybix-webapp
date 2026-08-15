-- Existing-ID-as-SKU correction -- production preflight, READ-ONLY.
--
-- Every statement below is a SELECT against information_schema/pg_catalog
-- or the app's own tables -- no INSERT/UPDATE/DELETE/DDL, no secrets.
-- Safe to paste and run as one query in the Supabase SQL editor. This was
-- NOT run against production during this session -- report the results
-- back before relying on them for a deployment decision.
--
-- Run this AFTER both migrations
-- (20260813221000_commerce_sku_standardization.sql and
-- 20260815120000_existing_id_as_commerce_sku.sql) have been applied, to
-- confirm the corrected state before switching application code over.

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
)

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
