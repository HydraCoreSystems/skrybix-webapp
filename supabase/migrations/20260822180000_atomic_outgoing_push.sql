-- Reliability Phase 1: atomic, idempotent outgoing push.
-- See supabase/schema.sql for the full design rationale (same block,
-- kept in sync -- this migration exists only so a live production
-- database, which already has cuttings/outgoing_log, can pick up the new
-- function without a fresh schema.sql apply).

create or replace function public.skrybix_push_cuttings_to_outgoing(
  p_cutting_ids text[],
  p_reason text,
  p_selling_platform text default null,
  p_notes text default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to log outgoing cuttings.';
  end if;

  with target as (
    select cutting_id, full_display_name
    from cuttings
    where cutting_id = any(p_cutting_ids)
      and archived_at is null
    for update
  ),
  inserted as (
    insert into outgoing_log (cutting_id, full_display_name, qty, reason, selling_platform, notes)
    select cutting_id, full_display_name, 1, p_reason, p_selling_platform, p_notes
    from target
    returning cutting_id
  )
  update cuttings
  set archived_at = now()
  where cutting_id in (select cutting_id from inserted);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.skrybix_push_cuttings_to_outgoing(text[], text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.skrybix_push_cuttings_to_outgoing(text[], text, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.skrybix_push_cuttings_to_outgoing(text[], text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skrybix_push_cuttings_to_outgoing(text[], text, text, text) to service_role;
  end if;
end $$;
