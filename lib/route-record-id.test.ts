import test from "node:test";
import assert from "node:assert/strict";
import { routeRecordId } from "./route-record-id.ts";

test("decodes a route-safe mother id containing a space", () => {
  assert.equal(routeRecordId("HY-AH%2003"), "HY-AH 03");
});

test("leaves an already-decoded record id unchanged", () => {
  assert.equal(routeRecordId("HY-POL02-C31"), "HY-POL02-C31");
});

test("fails safely when a malformed percent sequence reaches the route", () => {
  assert.equal(routeRecordId("HY-%ZZ"), "HY-%ZZ");
});
