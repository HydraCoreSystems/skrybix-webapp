-- Existing-ID-as-SKU correction -- SQL-level test script.
--
-- Covers the corrected select_mother_for_commerce(text, ...)/
-- select_cutting_for_commerce(text) overloads (see
-- supabase/migrations/20260815120000_existing_id_as_commerce_sku.sql),
-- run as service_role -- the app's real access path, and the only role
-- with EXECUTE on these new overloads. NOT meant to run against
-- production (throwaway HY-ICE/HY-AH/HY-FAIL fixture rows).
--
-- Usage: apply supabase/schema.sql (or the two migrations in order),
-- then `set role service_role;`, then this file.

set role service_role;

insert into mother_plants (mother_id, display_name, genus, species) values
  ('HY-ICE01', 'Hoya iceana', 'Hoya', 'iceana'),
  ('HY-AH 01', 'Hoya AH Black Magic', 'Hoya', null);

insert into cuttings (cutting_id, mother_id, full_display_name, date_taken) values
  ('HY-ICE01-C01', 'HY-ICE01', 'Hoya iceana', current_date),
  ('HY-ICE01-C99', 'HY-ICE01', 'Hoya iceana', current_date),
  ('HY-ICE01-C100', 'HY-ICE01', 'Hoya iceana', current_date),
  ('HY-AH 01-C08', 'HY-AH 01', 'Hoya AH Black Magic', current_date);

-- Expect: sku = mother_id, byte-for-byte
\echo '--- mother selection returns the exact mother_id, no separate SKU ---'
select select_mother_for_commerce(
  'HY-ICE01', 'exact_plant', '6in', '18in vine', true, 'ships_in_pot', null, 'Recently cut back for shipping'
) as sku;

-- Expect: sku = 'HY-AH 01', embedded space preserved exactly
\echo '--- embedded-space mother ID preserved exactly ---'
select select_mother_for_commerce(
  'HY-AH 01', 'representative_plant', '4in', '12in trailing', false, 'prepared_other', 'Bare-root wrapped in damp paper towel', null
) as sku;

-- Expect: each returns its own exact cutting_id
\echo '--- cutting selection returns the exact cutting_id (including C99/C100/embedded-space cases) ---'
select select_cutting_for_commerce('HY-ICE01-C01') as sku_c01;
select select_cutting_for_commerce('HY-ICE01-C99') as sku_c99;
select select_cutting_for_commerce('HY-ICE01-C100') as sku_c100;
select select_cutting_for_commerce('HY-AH 01-C08') as sku_ah_c08;

-- Expect: HY-ICE01 already selected above (by the mother selection
-- call), unaffected by any of the cutting selections -- selecting a
-- cutting never selects or exports its mother.
\echo '--- cutting selection never selects/exports its mother beyond what the mother call itself already did ---'
select mother_id, commerce_selected_at is not null as selected from mother_plants where mother_id in ('HY-ICE01', 'HY-AH 01') order by mother_id;

-- Expect: rejected -- cutting does not exist
\echo '--- fails closed on a nonexistent cutting ---'
select select_cutting_for_commerce('HY-DOESNOTEXIST-C01');

-- Expect: rejected -- mother does not exist
\echo '--- fails closed on a nonexistent mother ---'
select select_mother_for_commerce('HY-DOESNOTEXIST', 'exact_plant', '1', '1', true, 'ships_in_pot', null, null);

-- Expect: identical sku both times, mother_commerce_facts still exactly
-- one row for HY-ICE01 -- idempotent replay burns nothing and creates
-- no duplicate state.
\echo '--- idempotent replay: same identity, same result, no duplicate facts row ---'
select select_mother_for_commerce(
  'HY-ICE01', 'exact_plant', '6in', '18in vine', true, 'ships_in_pot', null, 'Recently cut back for shipping'
) as replayed_sku;
select count(*) as facts_rows_for_ice01 from mother_commerce_facts where source_record_id = 'HY-ICE01';

-- Expect: identical sku both times -- repeated cutting selection is
-- equally idempotent.
\echo '--- idempotent replay: cutting ---'
select select_cutting_for_commerce('HY-ICE01-C01') as replayed_cutting_sku;

-- Expect: rejected -- not-null violation on pot_size -- and the whole
-- call rolls back: no facts row, commerce_selected_at stays null.
\echo '--- failed mother selection leaves no partial facts/selection state ---'
insert into mother_plants (mother_id, display_name, genus, species) values ('HY-FAIL01', 'x', 'Hoya', 'testus');
select select_mother_for_commerce('HY-FAIL01', 'exact_plant', null, '10in', true, 'ships_in_pot', null, null);
select commerce_selected_at is null as still_unselected from mother_plants where mother_id = 'HY-FAIL01';
select count(*) as leftover_facts_rows from mother_commerce_facts where source_record_id = 'HY-FAIL01';

-- Expect: rejected -- prepared_other with no detail, same DB-level CHECK
-- as before, unaffected by this correction.
\echo '--- prepared_other still requires a detail string (unchanged DB CHECK) ---'
insert into mother_plants (mother_id, display_name, genus, species) values ('HY-FAIL02', 'x', 'Hoya', 'testus');
select select_mother_for_commerce('HY-FAIL02', 'exact_plant', '6in', '10in', true, 'prepared_other', null, null);

-- Expect: zero rows in every dormant object -- the corrected selection
-- path never writes to any of them, for either mother or cutting
-- selections performed above.
\echo '--- dormancy: no writes to any of the old genus/plant-code/registry/counter objects ---'
select count(*) as commerce_skus_rows from commerce_skus;
select count(*) as genus_codes_beyond_seed from genus_codes where code not in ('HY', 'AL');
select count(*) as plant_codes_rows from plant_codes;
select count(*) as mother_seq_counter_rows from commerce_mother_seq_counters;
select count(*) as cutting_seq_counter_rows from commerce_cutting_seq_counters;

reset role;

-- Expect: rejected -- the OLD genus/plant-code overloads are revoked
-- from service_role too, so even a caller with full app-level access
-- cannot reach them anymore. Run as service_role deliberately, to prove
-- the access path an actual attacker/misconfigured caller would have,
-- not the table owner's.
\echo '--- security: obsolete overloads are not executable by service_role ---'
set role service_role;
select select_cutting_for_commerce('HY-ICE01-C01', 'HY', 'ICE');
reset role;

set role service_role;
select select_mother_for_commerce('HY-ICE01', 'HY', 'ICE', 'exact_plant', '1', '1', true, 'ships_in_pot', null, null);
reset role;

-- Expect: rejected for both -- anon has neither the old nor the new
-- overload's EXECUTE privilege.
\echo '--- security: anon cannot execute either the old or new overloads ---'
set role anon;
select select_cutting_for_commerce('HY-ICE01-C01');
reset role;
set role anon;
select select_cutting_for_commerce('HY-ICE01-C01', 'HY', 'ICE');
reset role;
