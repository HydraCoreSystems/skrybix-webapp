-- Reliability Phase 1: atomic, idempotent outgoing push -- SQL-level test
-- script for skrybix_push_cuttings_to_outgoing() (supabase/schema.sql).
--
-- Run as service_role -- the app's real access path. NOT meant to run
-- against production (throwaway HY-OUT* fixture rows).
--
-- Usage: apply supabase/schema.sql, then `set role service_role;`, then
-- this file. Invoked without ON_ERROR_STOP so the deliberately-failing
-- statement below (blank reason) prints its error and the script
-- continues, same convention as existing_id_commerce_tests.sql.

set role service_role;

insert into mother_plants (mother_id, display_name, genus, species) values
  ('HY-OUT01', 'Hoya outgoing test', 'Hoya', 'testus');

insert into cuttings (cutting_id, mother_id, full_display_name, date_taken, sold) values
  ('HY-OUT01-C01', 'HY-OUT01', 'Hoya outgoing test', current_date, true),
  ('HY-OUT01-C02', 'HY-OUT01', 'Hoya outgoing test', current_date, false),
  ('HY-OUT01-C03', 'HY-OUT01', 'Hoya outgoing test', current_date, false);

-- Expect: pushed_count = 1, the cutting is archived, and exactly one
-- outgoing_log row with reason = 'Sale' -- both writes happened in one
-- statement, so there is no window where one exists without the other.
\echo '--- normal sale push: archives and logs atomically ---'
select skrybix_push_cuttings_to_outgoing(array['HY-OUT01-C01'], 'Sale') as pushed_count;
select archived_at is not null as archived from cuttings where cutting_id = 'HY-OUT01-C01';
select reason, qty from outgoing_log where cutting_id = 'HY-OUT01-C01';

-- Expect: retry_count = 0 -- the row is already archived (archived_at is
-- not null), so the target CTE finds nothing left to do. No duplicate
-- outgoing_log row, no re-archive. This is the idempotency guarantee: a
-- retried call (e.g. after a client-side timeout on an already-succeeded
-- request) can never double-log or clobber archived_at.
\echo '--- idempotent replay: retrying the same id logs/archives nothing new ---'
select skrybix_push_cuttings_to_outgoing(array['HY-OUT01-C01'], 'Sale') as retry_count;
select count(*) as outgoing_rows_for_c01 from outgoing_log where cutting_id = 'HY-OUT01-C01';

-- Expect: pushed_count = 1, reason = 'Gift', notes preserved. Proves the
-- same atomic path serves non-sale outgoing reasons (gift, loss,
-- disposal, trade, personal use), not just 'Sale' -- no separate code
-- path, no separate risk of partial writes for the non-sale case.
\echo '--- non-sale reason: Gift, with notes ---'
select skrybix_push_cuttings_to_outgoing(array['HY-OUT01-C02'], 'Gift', null, 'given to a friend') as gift_count;
select reason, notes, selling_platform is null as no_platform from outgoing_log where cutting_id = 'HY-OUT01-C02';

-- Expect: rejected -- a blank/whitespace reason must fail closed rather
-- than silently logging an empty-string reason. HY-OUT01-C03 stays
-- untouched (still active, no outgoing_log row) since the whole
-- statement aborts before either write.
\echo '--- fails closed on a blank reason ---'
select skrybix_push_cuttings_to_outgoing(array['HY-OUT01-C03'], '   ');
select archived_at is null as still_active from cuttings where cutting_id = 'HY-OUT01-C03';
select count(*) as outgoing_rows_for_c03 from outgoing_log where cutting_id = 'HY-OUT01-C03';

-- Expect: pushed_count = 1 -- only HY-OUT01-C03 (still active) is
-- processed; HY-OUT01-C01 (already archived from the first call above)
-- and a nonexistent id are silently skipped, not errored, matching the
-- existing batch-action convention (unknown/unavailable ids are
-- reported as skipped by the caller, not a hard failure for the batch).
\echo '--- mixed batch: already-archived and unknown ids are skipped, not errored ---'
select skrybix_push_cuttings_to_outgoing(
  array['HY-OUT01-C01', 'HY-OUT01-C03', 'HY-DOESNOTEXIST-C01'],
  'Loss'
) as mixed_batch_count;
select reason from outgoing_log where cutting_id = 'HY-OUT01-C03';

-- Expect: 0 -- anon must never reach this RPC directly (see the access
-- hardening block appended after skrybix_push_cuttings_to_outgoing in
-- supabase/schema.sql). Structural assertion, run without switching role
-- back first so this reflects the current (service_role) session -- the
-- real anon-denial check lives in verify_commerce_sku_migration.sh's
-- access-hardening section, this is just a sanity marker for this file.
\echo '--- sanity: function exists and is owned/executable under service_role as expected ---'
select count(*) as function_exists from pg_proc where proname = 'skrybix_push_cuttings_to_outgoing';
