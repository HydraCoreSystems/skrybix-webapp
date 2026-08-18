import assert from "node:assert/strict";
import test from "node:test";
import { chunkIntoSheets, parseStartPosition, sizeClassForLine, LABELS_PER_SHEET } from "./labels.ts";

test("sizeClassForLine: short names get the largest tier", () => {
  assert.equal(sizeClassForLine("Hoya carnosa"), "lg"); // 12 chars
});

test("sizeClassForLine: medium names get the medium tier", () => {
  assert.equal(sizeClassForLine("Hoya kerrii 'Albo'"), "md"); // 18 chars
});

test("sizeClassForLine: longer names get the small tier", () => {
  assert.equal(sizeClassForLine("Hoya sp. Sumatra 'Wide Leaf'"), "xs"); // 28 chars, past sm cutoff
  assert.equal(sizeClassForLine("Hoya carnosa 'Compacta'"), "sm"); // 23 chars
});

test("sizeClassForLine: very long names still get a floor, never crash", () => {
  const longName = "Hoya macrophylla ssp. globulosa 'Very Long Cultivar Name Indeed'";
  assert.equal(sizeClassForLine(longName), "xs");
});

test("sizeClassForLine: null/undefined/empty treated as shortest tier", () => {
  assert.equal(sizeClassForLine(null), "lg");
  assert.equal(sizeClassForLine(undefined), "lg");
  assert.equal(sizeClassForLine(""), "lg");
});

test("sizeClassForLine: tier boundaries are inclusive at the documented lengths", () => {
  assert.equal(sizeClassForLine("a".repeat(12)), "lg");
  assert.equal(sizeClassForLine("a".repeat(13)), "md");
  assert.equal(sizeClassForLine("a".repeat(18)), "md");
  assert.equal(sizeClassForLine("a".repeat(19)), "sm");
  assert.equal(sizeClassForLine("a".repeat(26)), "sm");
  assert.equal(sizeClassForLine("a".repeat(27)), "xs");
});

// Pre-existing behavior, unmodified by this change -- kept here as a
// regression guard since this file now covers all of lib/labels.ts.
test("parseStartPosition/chunkIntoSheets: unchanged sanity checks", () => {
  assert.equal(parseStartPosition(undefined), 1);
  assert.equal(parseStartPosition("5"), 5);
  assert.equal(parseStartPosition("999"), LABELS_PER_SHEET);
  const chunks = chunkIntoSheets(["a", "b", "c"], 5);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].blanks, 4);
  assert.deepEqual(chunks[0].items, ["a", "b", "c"]);
});
