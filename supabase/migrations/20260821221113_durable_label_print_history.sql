alter table public.mother_plants
  add column if not exists label_print_count integer not null default 0,
  add column if not exists label_last_printed_at timestamptz;

alter table public.cuttings
  add column if not exists label_print_count integer not null default 0,
  add column if not exists label_last_printed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mother_plants_label_print_count_nonnegative'
  ) then
    alter table public.mother_plants
      add constraint mother_plants_label_print_count_nonnegative check (label_print_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cuttings_label_print_count_nonnegative'
  ) then
    alter table public.cuttings
      add constraint cuttings_label_print_count_nonnegative check (label_print_count >= 0);
  end if;
end
$$;

create or replace function public.skrybix_mark_mother_labels_printed(p_mother_ids text[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.mother_plants
  set print_label = false,
      label_print_count = label_print_count + 1,
      label_last_printed_at = now()
  where mother_id = any(p_mother_ids)
    and print_label = true;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.skrybix_mark_cutting_labels_printed(p_cutting_ids text[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.cuttings
  set print_label = false,
      label_print_count = label_print_count + 1,
      label_last_printed_at = now()
  where cutting_id = any(p_cutting_ids)
    and print_label = true;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.skrybix_mark_mother_labels_printed(text[]) from public;
revoke all on function public.skrybix_mark_mother_labels_printed(text[]) from anon;
revoke all on function public.skrybix_mark_mother_labels_printed(text[]) from authenticated;
grant execute on function public.skrybix_mark_mother_labels_printed(text[]) to service_role;

revoke all on function public.skrybix_mark_cutting_labels_printed(text[]) from public;
revoke all on function public.skrybix_mark_cutting_labels_printed(text[]) from anon;
revoke all on function public.skrybix_mark_cutting_labels_printed(text[]) from authenticated;
grant execute on function public.skrybix_mark_cutting_labels_printed(text[]) to service_role;
