-- Commerce SKU standardization -- SQL-level test script.
--
-- These are the database-boundary guarantees the owner's decision
-- record requires (atomicity, concurrency safety, immutability) that
-- cannot be exercised from lib/commerce-export.test.ts, since they live
-- in Postgres functions/constraints, not JS. This script was run
-- against a real local Postgres 16 instance before the corresponding
-- application code shipped -- see the implementation report for the
-- exact commands and captured output. Re-run this against any fresh
-- database (local or a disposable Supabase branch) to reproduce that
-- verification; it is NOT meant to run against production (it inserts
-- throwaway fixture rows with HY-TST/HY-CAR/HY-KRQ/HY-AH ids).
--
-- Usage: apply supabase/schema.sql first, then this file, then read
-- through the \echo labels and compare actual output to the expected
-- result noted in each comment.

insert into mother_plants (mother_id, display_name, genus, species) values
  ('HY-CAR01', 'Hoya carnosa', 'Hoya', 'carnosa'),
  ('HY-KRQ01', 'Hoya krohniana', 'Hoya', 'krohniana'),
  ('HY-AH 05', 'Hoya AH Black Magic', 'Hoya', null);

insert into cuttings (cutting_id, mother_id, full_display_name, date_taken) values
  ('HY-CAR01-C01', 'HY-CAR01', 'Hoya carnosa', current_date),
  ('HY-KRQ01-C01', 'HY-KRQ01', 'Hoya krohniana', current_date),
  ('HY-KRQ01-C02', 'HY-KRQ01', 'Hoya krohniana', current_date);

insert into plant_codes (genus_code, code, display_label) values
  ('HY', 'KRQ', 'Hoya krohniana'),
  ('HY', 'CAR', 'Hoya carnosa'),
  ('HY', 'ABH', 'AH Black Magic');

-- Expect: rejected, duplicate genus_codes.code
\echo '--- genus code uniqueness ---'
insert into genus_codes (code, genus_name) values ('HY', 'Hoya duplicate');

-- Expect: both rejected by the CHECK constraint on plant_codes.code
\echo '--- invalid plant code shape ---'
insert into plant_codes (genus_code, code, display_label) values ('HY','abc','bad');
insert into plant_codes (genus_code, code, display_label) values ('HY','ABCD','bad');

-- Expect: rejected -- same genus, same code, already taken
\echo '--- duplicate plant code within a genus ---'
insert into plant_codes (genus_code, code, display_label) values ('HY','KRQ','dup');

-- Expect: succeeds -- same 3-char code is fine in a DIFFERENT genus
\echo '--- same plant code, different genus: allowed ---'
insert into plant_codes (genus_code, code, display_label) values ('AL','KRQ','coincidental reuse');

-- Expect: sku = HY-CAR-01, sourceRecordId (HY-CAR01) != sku
\echo '--- select mother, full required facts ---'
select select_mother_for_commerce(
  'HY-CAR01', 'HY', 'CAR', 'exact_plant', '6in', '18in vine', true,
  'ships_in_pot', null, 'Recently cut back for shipping'
) as sku;

-- Expect: sku = HY-ABH-01 -- confirms a real space-containing
-- source_record_id ("HY-AH 05") is preserved exactly and still resolves
select select_mother_for_commerce(
  'HY-AH 05', 'HY', 'ABH', 'representative_plant', '4in', '12in trailing',
  false, 'prepared_other', 'Bare-root wrapped in damp paper towel', null
) as sku;

-- Expect: cutting sku = HY-KRQ-01-C01; mother_plants.commerce_selected_at
-- for HY-KRQ01 is still NULL (reservation must never select/export the
-- mother)
\echo '--- cutting selection reserves (never selects/exports) its mother ---'
select select_cutting_for_commerce('HY-KRQ01-C01', 'HY-KRQ01', 'HY', 'KRQ') as cutting_sku;
select mother_id, commerce_selected_at from mother_plants where mother_id = 'HY-KRQ01';

-- Expect: sku = HY-KRQ-01-C02 -- reuses the same mother SKU, distinct
-- cutting sequence
select select_cutting_for_commerce('HY-KRQ01-C02', 'HY-KRQ01', 'HY', 'KRQ') as cutting_sku_2;

-- Expect: DB-enforced immutability -- all four rejected
\echo '--- immutability + registry protection ---'
update commerce_skus set sku = 'HACKED-01' where source_record_id = 'HY-CAR01';
delete from plant_codes where genus_code='HY' and code='CAR';
update plant_codes set code = 'XXX' where genus_code='HY' and code='CAR';
delete from genus_codes where code='HY';

-- Expect: rejected, not-null violation on pot_size
\echo '--- required mother facts validated at the database boundary ---'
insert into mother_plants (mother_id, display_name, genus, species) values ('HY-TST03', 'x', 'Hoya', 'testus');
insert into plant_codes (genus_code, code, display_label) values ('HY','TST','Hoya test race');
select select_mother_for_commerce('HY-TST03','HY','TST','exact_plant',null,'10in',true,'ships_in_pot',null,null);

-- Expect: no leftover commerce_skus row for HY-TST03 -- the failed call's
-- SKU assignment rolled back along with the failed facts insert
select count(*) as leftover_sku_rows from commerce_skus where source_record_id='HY-TST03';

-- Real concurrency tests (require two separate psql connections, not
-- expressible as plain sequential SQL in this file) -- see the
-- implementation report for the exact shell commands and captured
-- output. Summary of what was verified:
--   - Two cuttings selected concurrently from the same never-before-
--     selected mother: exactly one mother_seq/mother SKU allocated,
--     two distinct cutting sequences, mother never marked selected.
--   - Two concurrent calls selecting the SAME mother for commerce:
--     converge on exactly one commerce_skus row (idempotent).
