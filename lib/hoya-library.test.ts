import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionProgress,
  displayBotanicalName,
  filterHoyaSpecies,
  type HoyaSpeciesRecord,
} from "./hoya-library.ts";

function species(overrides: Partial<HoyaSpeciesRecord> = {}): HoyaSpeciesRecord {
  return {
    id: 1,
    genus: "Hoya",
    species: "carnosa",
    in_collection: false,
    date_added: null,
    preferred_id_code: null,
    native_range: "East Asia & Australia",
    region_group: "Asia-Pacific",
    growth_habit: "Climbing",
    leaf_notes: null,
    bloom_notes: null,
    authority: "R. Br.",
    notes: null,
    source: "POWO (Kew)",
    unique_id: null,
    ...overrides,
  };
}

test("collection progress is based on ever-collected records", () => {
  assert.deepEqual(collectionProgress([species({ in_collection: true }), species({ id: 2 })]), {
    collected: 1,
    total: 2,
    percent: 50,
  });
});

test("collection progress handles an empty library", () => {
  assert.deepEqual(collectionProgress([]), { collected: 0, total: 0, percent: 0 });
});

test("filters collected and not-collected records independently", () => {
  const rows = [species({ in_collection: true }), species({ id: 2, species: "polyneura" })];
  assert.deepEqual(filterHoyaSpecies(rows, "", "collected", "").map((row) => row.species), ["carnosa"]);
  assert.deepEqual(filterHoyaSpecies(rows, "", "not-collected", "").map((row) => row.species), ["polyneura"]);
});

test("search matches scientific name, authority, range, and notes", () => {
  const rows = [species(), species({ id: 2, species: "polyneura", native_range: "Himalaya", authority: "Hook. f." })];
  assert.equal(filterHoyaSpecies(rows, "himalaya", "all", "")[0].species, "polyneura");
  assert.equal(filterHoyaSpecies(rows, "hook", "all", "")[0].species, "polyneura");
});

test("region filter combines with text and collection filters", () => {
  const rows = [
    species({ in_collection: true }),
    species({ id: 2, species: "linearis", in_collection: true, region_group: "Himalaya", native_range: "Nepal" }),
  ];
  assert.deepEqual(filterHoyaSpecies(rows, "nepal", "collected", "Himalaya").map((row) => row.species), ["linearis"]);
});

test("botanical display name uses genus and species", () => {
  assert.equal(displayBotanicalName(species({ species: "polyneura" })), "Hoya polyneura");
});
