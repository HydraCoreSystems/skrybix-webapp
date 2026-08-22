#!/usr/bin/env bash
# Permanent CI verification for the commerce SKU standardization system
# AND the existing-ID-as-SKU correction on top of it
# (supabase/schema.sql + supabase/migrations/*.sql).
#
# This replaces "a developer manually ran a SQL script once" with a
# repeatable, scripted check that CI runs on every push/PR. It proves,
# against a real Postgres server (not reasoned about on paper):
#
#   1. supabase/schema.sql applies cleanly to a fresh database.
#   2. All forward migrations apply cleanly, in order, to a database
#      seeded with a frozen, checked-in pre-migration schema fixture
#      (supabase/fixtures/pre_20260815120000_schema.sql, simulating
#      production before this correction).
#   3. Both paths produce a byte-identical resulting schema (parity).
#   4. Re-applying every migration a second time is a safe no-op.
#   5. The access-hardening block blocks anon/authenticated and leaves
#      service_role fully working, simulating Supabase's real
#      default-privilege model -- for BOTH the original commerce-SKU
#      objects and the corrected existing-ID-as-SKU overloads.
#   6. The original commerce_sku_tests.sql suite still passes when run
#      as the table owner (its genus/plant-code overloads are now
#      dormant -- EXECUTE was intentionally revoked from service_role).
#   7. The corrected existing_id_commerce_tests.sql suite passes as
#      service_role -- exact identity preservation, atomicity,
#      idempotency, dormancy of the old registry/counter objects, and
#      that the old overloads are genuinely inaccessible even to
#      service_role.
#   8. Two real concurrent processes selecting two cuttings under the
#      same never-before-selected mother succeed independently (no
#      shared counter/registry to contend over anymore).
#   9. Two real concurrent processes selecting the SAME cutting converge
#      safely -- both return the identical SKU, the record is selected
#      exactly once.
#  10. No orphaned commerce_skus/genus_codes/plant_codes/counter rows are
#      ever created by the corrected selection path.
#  11. supabase/existing_id_correction_preflight.sql correctly classifies
#      both the pre-migration (only old signatures) and post-migration
#      (old+new signatures, old revoked, new service_role-only) states via
#      its phase_detection row, and fails closed (unexpected_signature_state)
#      on a state matching neither shape -- without ever calling an RPC.
#  12. (Reliability Phase 1) skrybix_push_cuttings_to_outgoing() -- the
#      atomic, idempotent outgoing-log push introduced in
#      supabase/migrations/20260822180000_atomic_outgoing_push.sql --
#      archives a cutting and logs it in one statement, is a safe no-op
#      on retry, supports non-sale reasons, skips already-archived/
#      unknown ids without erroring, and fails closed on a blank reason.
#      See supabase/outgoing_push_tests.sql.
#
# Expects PGHOST/PGPORT/PGUSER/PGPASSWORD to already be set in the
# environment (standard libpq vars) pointing at a throwaway Postgres
# server/database this script is free to create/drop databases on --
# never point this at anything with real data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA_SQL="$REPO_ROOT/supabase/schema.sql"
MIGRATION_1_SQL="$REPO_ROOT/supabase/migrations/20260813221000_commerce_sku_standardization.sql"
MIGRATION_2_SQL="$REPO_ROOT/supabase/migrations/20260815120000_existing_id_as_commerce_sku.sql"
MIGRATION_3_SQL="$REPO_ROOT/supabase/migrations/20260821221113_durable_label_print_history.sql"
MIGRATION_4_SQL="$REPO_ROOT/supabase/migrations/20260822180000_atomic_outgoing_push.sql"
LEGACY_TESTS_SQL="$REPO_ROOT/supabase/commerce_sku_tests.sql"
CORRECTION_TESTS_SQL="$REPO_ROOT/supabase/existing_id_commerce_tests.sql"
PREFLIGHT_SQL="$REPO_ROOT/supabase/existing_id_correction_preflight.sql"
OUTGOING_PUSH_TESTS_SQL="$REPO_ROOT/supabase/outgoing_push_tests.sql"
# Checked-in, immutable snapshot of supabase/schema.sql as of commit
# a4f69f1c94d807c5df8c50926d00eccf5e14e8eb (PR #11's merge -- the last
# commit before 20260815120000_existing_id_as_commerce_sku.sql existed).
# Deliberately NOT `git show origin/master:supabase/schema.sql`: that
# used to work as a "pre-PR baseline" stand-in only by coincidence, while
# this PR's branch had not yet been merged. The moment it merges,
# origin/master IS the corrected schema, so a script that re-derives its
# "pre-migration" fixture from origin/master silently starts asserting
# the wrong thing post-merge (caught for real: CI run 31887035830 failed
# on master with `phase_detection` correctly returning 'post_migration'
# against a test that still expected 'pre_migration'). A frozen fixture
# tied to an explicit historical SHA can't drift out from under the
# script the way a branch ref can.
PRE_MIGRATION_SCHEMA_FIXTURE="$REPO_ROOT/supabase/fixtures/pre_20260815120000_schema.sql"

FRESH_DB="skrybix_ci_fresh"
UPGRADE_DB="skrybix_ci_upgrade"
CONCURRENCY_DB="skrybix_ci_concurrency"
LEGACY_FUNCTIONAL_DB="skrybix_ci_legacy_functional"
CORRECTION_FUNCTIONAL_DB="skrybix_ci_correction_functional"
PREFLIGHT_PRE_DB="skrybix_ci_preflight_pre"
PREFLIGHT_UNEXPECTED_DB="skrybix_ci_preflight_unexpected"
OUTGOING_PUSH_DB="skrybix_ci_outgoing_push"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

psql_admin() {
  psql -v ON_ERROR_STOP=1 -X -q "$@"
}

setup_supabase_roles() {
  local db="$1"
  # Real Supabase projects always have these three roles with these exact
  # semantics: service_role bypasses RLS unconditionally, anon/authenticated
  # do not. Mirror that here so the hardening block in schema.sql is
  # exercised the same way it will be for real, not merely present in the
  # file untested. Roles are cluster-wide -- only create if missing.
  psql_admin -d postgres -c "
    do \$\$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end
    \$\$;
  "
  psql_admin -d "$db" -c "
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  "
}

echo "=== [1/10] Fresh schema.sql apply ==="
psql_admin -d postgres -c "drop database if exists $FRESH_DB;"
psql_admin -d postgres -c "create database $FRESH_DB owner $PGUSER;"
setup_supabase_roles "$FRESH_DB"
psql_admin -d "$FRESH_DB" -f "$SCHEMA_SQL"
pass "schema.sql applied to a fresh database with no errors"

echo "=== [2/10] Upgrade path: pre-PR schema, then all forward migrations in order ==="
psql_admin -d postgres -c "drop database if exists $UPGRADE_DB;"
psql_admin -d postgres -c "create database $UPGRADE_DB owner $PGUSER;"
setup_supabase_roles "$UPGRADE_DB"

[ -f "$PRE_MIGRATION_SCHEMA_FIXTURE" ] \
  || fail "missing $PRE_MIGRATION_SCHEMA_FIXTURE -- the checked-in pre-migration schema fixture"
psql_admin -d "$UPGRADE_DB" -f "$PRE_MIGRATION_SCHEMA_FIXTURE"
pass "pre-migration (frozen a4f69f1 fixture) schema applied cleanly, simulating current production"

psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_1_SQL"
pass "commerce-SKU standardization migration applied cleanly"

psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_2_SQL"
pass "existing-ID-as-SKU correction migration applied cleanly on top of it"

psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_3_SQL"
pass "durable label-print history migration applied cleanly on top of it"

psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_4_SQL"
pass "atomic outgoing push migration applied cleanly on top of it"

echo "=== [3/10] Schema object parity between fresh and upgrade paths ==="
FRESH_DUMP="$(mktemp)"
UPGRADE_DUMP="$(mktemp)"
pg_dump -s -d "$FRESH_DB" --no-owner --no-privileges | grep -v -- '--$' | grep -v '^\\restrict' | grep -v '^\\unrestrict' > "$FRESH_DUMP"
pg_dump -s -d "$UPGRADE_DB" --no-owner --no-privileges | grep -v -- '--$' | grep -v '^\\restrict' | grep -v '^\\unrestrict' > "$UPGRADE_DUMP"
if ! diff -q "$FRESH_DUMP" "$UPGRADE_DUMP" > /dev/null; then
  diff "$FRESH_DUMP" "$UPGRADE_DUMP" || true
  fail "fresh schema.sql apply and migration-upgraded schema are NOT identical -- see diff above"
fi
pass "fresh apply and migration-upgraded schema are structurally identical"

FRESH_GRANTS=$(psql -d "$FRESH_DB" -tAc "select proname || '|' || pg_get_function_identity_arguments(oid) || '|' || coalesce((select array_agg(grantee::regrole::text order by grantee::regrole::text) from aclexplode(proacl) where privilege_type='EXECUTE'), '{}') from pg_proc where proname in ('select_mother_for_commerce','select_cutting_for_commerce','skrybix_mark_mother_labels_printed','skrybix_mark_cutting_labels_printed','skrybix_push_cuttings_to_outgoing') order by 1;")
UPGRADE_GRANTS=$(psql -d "$UPGRADE_DB" -tAc "select proname || '|' || pg_get_function_identity_arguments(oid) || '|' || coalesce((select array_agg(grantee::regrole::text order by grantee::regrole::text) from aclexplode(proacl) where privilege_type='EXECUTE'), '{}') from pg_proc where proname in ('select_mother_for_commerce','select_cutting_for_commerce','skrybix_mark_mother_labels_printed','skrybix_mark_cutting_labels_printed','skrybix_push_cuttings_to_outgoing') order by 1;")
[ "$FRESH_GRANTS" = "$UPGRADE_GRANTS" ] || fail "EXECUTE grants on application RPCs differ between fresh and upgrade paths"
pass "EXECUTE grants on commerce and durable label-print RPCs are identical between fresh and upgrade paths"

echo "=== [4/10] Migration re-apply is a safe no-op (all migrations) ==="
psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_1_SQL"
psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_2_SQL"
psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_3_SQL"
psql_admin -d "$UPGRADE_DB" -f "$MIGRATION_4_SQL"
pass "re-applying all migrations a second time produced no errors"

echo "=== [5/10] Access hardening: anon/authenticated blocked, service_role works (original + corrected objects) ==="
DENIED_TABLE=$(psql -d "$FRESH_DB" -tAc "set role anon; select count(*) from commerce_skus;" 2>&1 || true)
echo "$DENIED_TABLE" | grep -qi "permission denied" || fail "anon role was NOT denied read access to commerce_skus"
pass "anon role denied table read on commerce_skus (RLS with no policies)"

DENIED_NEW_CUTTING=$(psql -d "$FRESH_DB" -tAc "set role anon; select select_cutting_for_commerce('x');" 2>&1 || true)
echo "$DENIED_NEW_CUTTING" | grep -qi "permission denied" || fail "anon role was NOT denied EXECUTE on the new select_cutting_for_commerce(text)"
pass "anon role denied EXECUTE on the corrected select_cutting_for_commerce(text)"

DENIED_OLD_CUTTING_SVC=$(psql -d "$FRESH_DB" -tAc "set role service_role; select select_cutting_for_commerce('x','HY','ABC');" 2>&1 || true)
echo "$DENIED_OLD_CUTTING_SVC" | grep -qi "permission denied" || fail "service_role was NOT denied EXECUTE on the obsolete select_cutting_for_commerce(text,char,text) -- old overload is not dormant"
pass "service_role denied EXECUTE on the obsolete genus/plant-code select_cutting_for_commerce overload (dormant, not merely unused)"

psql -d "$FRESH_DB" -v ON_ERROR_STOP=1 -tAc "
  set role service_role;
  insert into mother_plants (mother_id, display_name, genus, species) values ('HY-CIACC01','Hoya ci access test','Hoya','testus');
  select select_mother_for_commerce('HY-CIACC01','exact_plant','6in','18in',true,'ships_in_pot',null,null);
" > /dev/null || fail "service_role (the app's real access path) was unexpectedly blocked on the corrected select_mother_for_commerce"
pass "service_role retains full access to the corrected overloads"

DENIED_LABEL_PRINT=$(psql -d "$FRESH_DB" -tAc "set role anon; select skrybix_mark_cutting_labels_printed(array['x']);" 2>&1 || true)
echo "$DENIED_LABEL_PRINT" | grep -qi "permission denied" || fail "anon role was NOT denied EXECUTE on skrybix_mark_cutting_labels_printed"
pass "anon role denied EXECUTE on durable label-print RPCs"

DENIED_OUTGOING_PUSH=$(psql -d "$FRESH_DB" -tAc "set role anon; select skrybix_push_cuttings_to_outgoing(array['x'], 'Sale');" 2>&1 || true)
echo "$DENIED_OUTGOING_PUSH" | grep -qi "permission denied" || fail "anon role was NOT denied EXECUTE on skrybix_push_cuttings_to_outgoing"
pass "anon role denied EXECUTE on the atomic outgoing push RPC"

psql_admin -d "$FRESH_DB" -c "
  insert into mother_plants (mother_id, display_name, genus, species, print_label)
  values ('HY-PRINT01','Hoya print history test','Hoya','testus', true);
  insert into cuttings (cutting_id, mother_id, full_display_name, print_label)
  values ('HY-PRINT01-C01','HY-PRINT01','Hoya print history test', true);
"
# `set role service_role;` emits a "SET" command tag that psql -t does not
# suppress; take the last line so we compare the RPC's integer result, exactly
# as the concurrency checks below do (tail -1).
PRINTED_COUNT=$(psql -d "$FRESH_DB" -tAc "set role service_role; select skrybix_mark_cutting_labels_printed(array['HY-PRINT01-C01']);" | tail -1)
[ "$PRINTED_COUNT" = "1" ] || fail "label-print RPC should update exactly one queued cutting, got '$PRINTED_COUNT'"
PRINTED_STATE=$(psql -d "$FRESH_DB" -tAc "select (not print_label) and label_print_count = 1 and label_last_printed_at is not null from cuttings where cutting_id = 'HY-PRINT01-C01';")
[ "$PRINTED_STATE" = "t" ] || fail "label-print RPC did not atomically clear queue and preserve print history"
REPLAY_COUNT=$(psql -d "$FRESH_DB" -tAc "set role service_role; select skrybix_mark_cutting_labels_printed(array['HY-PRINT01-C01']);" | tail -1)
[ "$REPLAY_COUNT" = "0" ] || fail "replaying a completed print should update zero rows, got '$REPLAY_COUNT'"
REPLAY_STATE=$(psql -d "$FRESH_DB" -tAc "select label_print_count = 1 from cuttings where cutting_id = 'HY-PRINT01-C01';")
[ "$REPLAY_STATE" = "t" ] || fail "replaying a completed print incorrectly incremented print history"
pass "durable label-print RPC atomically records one print, clears its queue entry, and is replay-safe"

# Reprint cycle (production bug fix, 2026-08-22): a previously-printed
# cutting must remain eligible to be queued and printed again -- see
# isPrintSelectable/cuttingPrintState in lib/cuttings-batch.ts. Simulate
# Phil re-queuing HY-PRINT01-C01 (already at label_print_count = 1 from
# above) and confirming a second print: label_print_count must go from
# 1x to 2x, label_last_printed_at must advance to the new confirmation
# time (not stay frozen at the first print), and the replay/idempotency
# guarantee must hold at this new count too, not just at count 0->1.
FIRST_PRINTED_AT=$(psql -d "$FRESH_DB" -tAc "select label_last_printed_at from cuttings where cutting_id = 'HY-PRINT01-C01';")
psql_admin -d "$FRESH_DB" -c "update cuttings set print_label = true where cutting_id = 'HY-PRINT01-C01';"
REPRINT_COUNT=$(psql -d "$FRESH_DB" -tAc "set role service_role; select skrybix_mark_cutting_labels_printed(array['HY-PRINT01-C01']);" | tail -1)
[ "$REPRINT_COUNT" = "1" ] || fail "reprint confirmation should update exactly one re-queued cutting, got '$REPRINT_COUNT'"
REPRINT_STATE=$(psql -d "$FRESH_DB" -tAc "
  select (not print_label) and label_print_count = 2 and label_last_printed_at > '$FIRST_PRINTED_AT'::timestamptz
  from cuttings where cutting_id = 'HY-PRINT01-C01';
")
[ "$REPRINT_STATE" = "t" ] || fail "reprint confirmation did not increment label_print_count from 1x to 2x and advance label_last_printed_at"
REPRINT_REPLAY_COUNT=$(psql -d "$FRESH_DB" -tAc "set role service_role; select skrybix_mark_cutting_labels_printed(array['HY-PRINT01-C01']);" | tail -1)
[ "$REPRINT_REPLAY_COUNT" = "0" ] || fail "replaying a completed reprint should update zero rows, got '$REPRINT_REPLAY_COUNT'"
REPRINT_REPLAY_STATE=$(psql -d "$FRESH_DB" -tAc "select label_print_count = 2 from cuttings where cutting_id = 'HY-PRINT01-C01';")
[ "$REPRINT_REPLAY_STATE" = "t" ] || fail "replaying a completed reprint incorrectly changed print history"
pass "reprint confirmation increments label_print_count from 1x to 2x, advances label_last_printed_at, and is replay-safe at that count too"

echo "=== [6/10] Legacy functional/negative-path suite (dormant genus/plant-code path, run as table owner) ==="
psql_admin -d postgres -c "drop database if exists $LEGACY_FUNCTIONAL_DB;"
psql_admin -d postgres -c "create database $LEGACY_FUNCTIONAL_DB owner $PGUSER;"
setup_supabase_roles "$LEGACY_FUNCTIONAL_DB"
psql_admin -d "$LEGACY_FUNCTIONAL_DB" -f "$SCHEMA_SQL"
# commerce_sku_tests.sql intentionally exercises rejected/error paths, and
# (as of the correction) must run as the table owner, not service_role --
# EXECUTE on these obsolete overloads is deliberately revoked from
# service_role. Capture output and check for the specific markers instead
# of a bare exit code.
LEGACY_OUTPUT="$(psql -d "$LEGACY_FUNCTIONAL_DB" -f "$LEGACY_TESTS_SQL" 2>&1)"
echo "$LEGACY_OUTPUT" | grep -q "leftover_sku_rows" || fail "commerce_sku_tests.sql did not run to completion"
echo "$LEGACY_OUTPUT" | grep -A2 "leftover_sku_rows" | tail -1 | grep -qE '^\s*0\s*$' \
  || fail "rollback-atomicity check left a leftover commerce_skus row behind"
pass "commerce_sku_tests.sql (dormant genus/plant-code path) ran to completion as table owner with the expected results"

echo "=== [7/10] Corrected existing_id_commerce_tests.sql suite (service_role) ==="
psql_admin -d postgres -c "drop database if exists $CORRECTION_FUNCTIONAL_DB;"
psql_admin -d postgres -c "create database $CORRECTION_FUNCTIONAL_DB owner $PGUSER;"
setup_supabase_roles "$CORRECTION_FUNCTIONAL_DB"
psql_admin -d "$CORRECTION_FUNCTIONAL_DB" -f "$SCHEMA_SQL"
CORRECTION_OUTPUT="$(psql -d "$CORRECTION_FUNCTIONAL_DB" -f "$CORRECTION_TESTS_SQL" 2>&1)"
echo "$CORRECTION_OUTPUT" | grep -q "HY-ICE01-C100" || fail "existing_id_commerce_tests.sql did not prove C100 identity preservation"
echo "$CORRECTION_OUTPUT" | grep -q "HY-AH 01-C08" || fail "existing_id_commerce_tests.sql did not prove the embedded-space cutting ID case"
echo "$CORRECTION_OUTPUT" | grep -A2 "leftover_facts_rows" | tail -1 | grep -qE '^\s*0\s*$' \
  || fail "failed mother selection left a leftover mother_commerce_facts row behind"
echo "$CORRECTION_OUTPUT" | grep -A2 "commerce_skus_rows" | tail -1 | grep -qE '^\s*0\s*$' \
  || fail "corrected selection path wrote a row to the dormant commerce_skus table"
echo "$CORRECTION_OUTPUT" | grep -c "permission denied for function" | grep -qE '^[4-9][0-9]*$' \
  || fail "expected at least 4 'permission denied' security assertions in existing_id_commerce_tests.sql output, found fewer"
pass "existing_id_commerce_tests.sql ran to completion with the expected identity, atomicity, dormancy, and security results"

echo "=== [8/10] Real concurrency: two cuttings under the same never-selected mother (corrected path) ==="
psql_admin -d postgres -c "drop database if exists $CONCURRENCY_DB;"
psql_admin -d postgres -c "create database $CONCURRENCY_DB owner $PGUSER;"
setup_supabase_roles "$CONCURRENCY_DB"
psql_admin -d "$CONCURRENCY_DB" -f "$SCHEMA_SQL"
psql_admin -d "$CONCURRENCY_DB" -c "
  insert into mother_plants (mother_id, display_name, genus, species) values ('HY-CCR01','Hoya concurrency test','Hoya','testus');
  insert into cuttings (cutting_id, mother_id, full_display_name, date_taken) values
    ('HY-CCR01-C01','HY-CCR01','Hoya concurrency test', current_date),
    ('HY-CCR01-C02','HY-CCR01','Hoya concurrency test', current_date);
"
psql -d "$CONCURRENCY_DB" -tAc "set role service_role; select select_cutting_for_commerce('HY-CCR01-C01');" > /tmp/ccr_out_a.txt 2>&1 &
PID_A=$!
psql -d "$CONCURRENCY_DB" -tAc "set role service_role; select select_cutting_for_commerce('HY-CCR01-C02');" > /tmp/ccr_out_b.txt 2>&1 &
PID_B=$!
wait "$PID_A" "$PID_B"

SKU_A_LINE=$(tail -1 /tmp/ccr_out_a.txt | tr -d '[:space:]')
SKU_B_LINE=$(tail -1 /tmp/ccr_out_b.txt | tr -d '[:space:]')
[ "$SKU_A_LINE" = "HY-CCR01-C01" ] || fail "expected select_cutting_for_commerce('HY-CCR01-C01') to return its own exact ID, got '$SKU_A_LINE'"
[ "$SKU_B_LINE" = "HY-CCR01-C02" ] || fail "expected select_cutting_for_commerce('HY-CCR01-C02') to return its own exact ID, got '$SKU_B_LINE'"
pass "two cuttings under the same mother, selected concurrently, each returned its own exact ID"

MOTHER_SELECTED=$(psql -d "$CONCURRENCY_DB" -tAc "select commerce_selected_at is not null from mother_plants where mother_id='HY-CCR01';")
[ "$MOTHER_SELECTED" = "f" ] || fail "mother HY-CCR01 was incorrectly marked selected as a side effect of cutting selection"
pass "mother was never selected/exported as a side effect of selecting its cuttings"

echo "=== [9/10] Real concurrency: two concurrent selections of the SAME cutting converge ==="
psql_admin -d "$CONCURRENCY_DB" -c "
  insert into mother_plants (mother_id, display_name, genus, species) values ('HY-CCR02','Hoya same-record test','Hoya','testus');
  insert into cuttings (cutting_id, mother_id, full_display_name, date_taken) values ('HY-CCR02-C01','HY-CCR02','Hoya same-record test', current_date);
"
psql -d "$CONCURRENCY_DB" -tAc "set role service_role; select select_cutting_for_commerce('HY-CCR02-C01');" > /tmp/ccr_same_a.txt 2>&1 &
PID_C=$!
psql -d "$CONCURRENCY_DB" -tAc "set role service_role; select select_cutting_for_commerce('HY-CCR02-C01');" > /tmp/ccr_same_b.txt 2>&1 &
PID_D=$!
wait "$PID_C" "$PID_D"

SKU_SAME_A=$(tail -1 /tmp/ccr_same_a.txt | tr -d '[:space:]')
SKU_SAME_B=$(tail -1 /tmp/ccr_same_b.txt | tr -d '[:space:]')
[ "$SKU_SAME_A" = "HY-CCR02-C01" ] && [ "$SKU_SAME_B" = "HY-CCR02-C01" ] \
  || fail "both concurrent callers should observe the identical exact cutting ID (got '$SKU_SAME_A' vs '$SKU_SAME_B')"
pass "two concurrent selections of the same cutting both observed the identical exact ID"

SELECTED_COUNT=$(psql -d "$CONCURRENCY_DB" -tAc "select count(*) from cuttings where cutting_id='HY-CCR02-C01' and commerce_selected_at is not null;")
[ "$SELECTED_COUNT" -eq 1 ] || fail "expected the cutting to be marked selected exactly once regardless of two concurrent callers"
pass "the cutting was marked selected exactly once despite two concurrent callers"

echo "=== [10/10] No orphaned dormant-object rows after any of the above ==="
ORPHAN_SKU=$(psql -d "$CONCURRENCY_DB" -tAc "select count(*) from commerce_skus;")
ORPHAN_PLANT_CODES=$(psql -d "$CONCURRENCY_DB" -tAc "select count(*) from plant_codes;")
[ "$ORPHAN_SKU" -eq 0 ] || fail "found $ORPHAN_SKU unexpected commerce_skus row(s) after the corrected concurrency scenarios"
[ "$ORPHAN_PLANT_CODES" -eq 0 ] || fail "found $ORPHAN_PLANT_CODES unexpected plant_codes row(s) after the corrected concurrency scenarios"
pass "no dormant-object rows were created by any of the corrected selection scenarios above"

echo "=== [11/11] Preflight phase detection: pre-migration, post-migration, and fail-closed on an unexpected state ==="
# Pre-migration: the frozen a4f69f1 fixture (migration 2 not applied yet)
# -- NOT origin/master, which is the corrected schema once this branch is
# merged. See the PRE_MIGRATION_SCHEMA_FIXTURE comment above for why.
psql_admin -d postgres -c "drop database if exists $PREFLIGHT_PRE_DB;"
psql_admin -d postgres -c "create database $PREFLIGHT_PRE_DB owner $PGUSER;"
setup_supabase_roles "$PREFLIGHT_PRE_DB"
psql_admin -d "$PREFLIGHT_PRE_DB" -f "$PRE_MIGRATION_SCHEMA_FIXTURE"
PRE_PHASE=$(psql -d "$PREFLIGHT_PRE_DB" -tAc "$(cat "$PREFLIGHT_SQL")" | grep '^phase_detection|' | cut -d'|' -f2)
[ "$PRE_PHASE" = "pre_migration" ] || fail "preflight phase_detection on pre-migration schema returned '$PRE_PHASE', expected 'pre_migration'"
pass "preflight correctly classifies the pre-migration state (only old signatures) as pre_migration, not an error"

# Post-migration: FRESH_DB already has schema.sql applied, which includes
# both forward migrations' effect in full (a fresh dump, not an upgrade
# path) -- reuse it rather than building a third database.
POST_PHASE=$(psql -d "$FRESH_DB" -tAc "$(cat "$PREFLIGHT_SQL")" | grep '^phase_detection|' | cut -d'|' -f2)
[ "$POST_PHASE" = "post_migration" ] || fail "preflight phase_detection on fully-corrected schema returned '$POST_PHASE', expected 'post_migration'"
pass "preflight correctly classifies the post-migration state (old+new signatures, old revoked, new service_role-only) as post_migration"

# Unexpected/fail-closed: take a fully-corrected schema and manually
# re-grant EXECUTE on an old, supposedly-dormant overload to service_role
# -- a state that must never be silently accepted as either expected shape.
psql_admin -d postgres -c "drop database if exists $PREFLIGHT_UNEXPECTED_DB;"
psql_admin -d postgres -c "create database $PREFLIGHT_UNEXPECTED_DB owner $PGUSER;"
setup_supabase_roles "$PREFLIGHT_UNEXPECTED_DB"
psql_admin -d "$PREFLIGHT_UNEXPECTED_DB" -f "$SCHEMA_SQL"
psql_admin -d "$PREFLIGHT_UNEXPECTED_DB" -c "
  grant execute on function select_cutting_for_commerce(text, character, text) to service_role;
"
UNEXPECTED_PHASE=$(psql -d "$PREFLIGHT_UNEXPECTED_DB" -tAc "$(cat "$PREFLIGHT_SQL")" | grep '^phase_detection|' | cut -d'|' -f2)
[ "$UNEXPECTED_PHASE" = "unexpected_signature_state" ] || fail "preflight phase_detection on a deliberately-broken grant state returned '$UNEXPECTED_PHASE', expected 'unexpected_signature_state' (fail closed)"
pass "preflight fails closed (unexpected_signature_state) when the old overload's EXECUTE grant is not actually revoked from service_role"

# The preflight file must remain provably read-only -- no statement other
# than SELECT/WITH may appear (belt-and-suspenders on top of manual review).
# String literals are stripped BEFORE comments (not the other way around):
# some of this file's own result strings contain a literal "--" as part of
# their English text, which would otherwise truncate a naive comment-strip
# mid-string and leave a spurious "grant"/"do not" fragment exposed.
PREFLIGHT_STRIPPED=$(sed -E "s/'([^']|'')*'//g" "$PREFLIGHT_SQL" | sed 's/--.*$//')
if echo "$PREFLIGHT_STRIPPED" | grep -qiE '\b(insert|update|delete|merge|create|alter|drop|grant|revoke|begin|commit|rollback|call)\b|\bdo\s*\$'; then
  fail "existing_id_correction_preflight.sql appears to contain a non-SELECT statement -- it must remain strictly read-only"
fi
pass "existing_id_correction_preflight.sql contains no DML/DDL/RPC/transaction-control keywords"

echo "=== [12/12] Atomic outgoing push: skrybix_push_cuttings_to_outgoing() ==="
psql_admin -d postgres -c "drop database if exists $OUTGOING_PUSH_DB;"
psql_admin -d postgres -c "create database $OUTGOING_PUSH_DB owner $PGUSER;"
setup_supabase_roles "$OUTGOING_PUSH_DB"
psql_admin -d "$OUTGOING_PUSH_DB" -f "$SCHEMA_SQL"
OUTGOING_OUTPUT="$(psql -d "$OUTGOING_PUSH_DB" -f "$OUTGOING_PUSH_TESTS_SQL" 2>&1)"
echo "$OUTGOING_OUTPUT" | grep -q "A reason is required to log outgoing cuttings" \
  || fail "outgoing_push_tests.sql did not exercise the fail-closed blank-reason path"
ARCHIVED_COUNT=$(psql -d "$OUTGOING_PUSH_DB" -tAc "select count(*) from cuttings where cutting_id in ('HY-OUT01-C01','HY-OUT01-C02','HY-OUT01-C03') and archived_at is not null;")
[ "$ARCHIVED_COUNT" -eq 3 ] || fail "expected exactly 3 archived test cuttings after outgoing_push_tests.sql (Sale + Gift + Loss), got $ARCHIVED_COUNT"
UNARCHIVED_OUTGOING=$(psql -d "$OUTGOING_PUSH_DB" -tAc "
  select count(*) from outgoing_log ol
  join cuttings c on c.cutting_id = ol.cutting_id
  where ol.cutting_id in ('HY-OUT01-C01','HY-OUT01-C02','HY-OUT01-C03') and c.archived_at is null;
")
[ "$UNARCHIVED_OUTGOING" -eq 0 ] || fail "found $UNARCHIVED_OUTGOING outgoing_log row(s) whose cutting was never archived -- the exact partial-write defect this function exists to prevent"
DUPLICATE_OUTGOING=$(psql -d "$OUTGOING_PUSH_DB" -tAc "
  select count(*) from (
    select cutting_id, count(*) c from outgoing_log
    where cutting_id in ('HY-OUT01-C01','HY-OUT01-C02','HY-OUT01-C03')
    group by cutting_id having count(*) > 1
  ) dup;
")
[ "$DUPLICATE_OUTGOING" -eq 0 ] || fail "found duplicate outgoing_log rows for a test cutting -- idempotent retry did not converge"
pass "skrybix_push_cuttings_to_outgoing atomically archives+logs, is idempotent on retry, supports non-sale reasons, skips already-archived/unknown ids, and fails closed on a blank reason"

echo
echo "=== ALL CHECKS PASSED ==="

psql_admin -d postgres -c "drop database if exists $FRESH_DB;"
psql_admin -d postgres -c "drop database if exists $UPGRADE_DB;"
psql_admin -d postgres -c "drop database if exists $CONCURRENCY_DB;"
psql_admin -d postgres -c "drop database if exists $LEGACY_FUNCTIONAL_DB;"
psql_admin -d postgres -c "drop database if exists $CORRECTION_FUNCTIONAL_DB;"
psql_admin -d postgres -c "drop database if exists $PREFLIGHT_PRE_DB;"
psql_admin -d postgres -c "drop database if exists $PREFLIGHT_UNEXPECTED_DB;"
psql_admin -d postgres -c "drop database if exists $OUTGOING_PUSH_DB;"
