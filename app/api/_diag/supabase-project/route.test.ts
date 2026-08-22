import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware, config as middlewareConfig } from "@/middleware";
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { GET, projectRefFromUrl } from "./route.ts";

// Temporary diagnostic route tests.
//
// Proves (1) the route is protected by Skrybix's existing site-password
// session gate — an unauthenticated request is denied, an authenticated
// session passes — and (2) the handler returns ONLY the Supabase project
// reference, never a key, token, password, or full URL.

process.env.AUTH_SECRET = "diag-test-auth-secret";

test("middleware denies an unauthenticated request (redirect to /login)", async () => {
  const req = new NextRequest("https://example.com/api/_diag/supabase-project");
  const res = await middleware(req);
  assert.equal(res.status, 307, "unauthenticated request must be redirected away, not served");
  assert.ok((res.headers.get("location") ?? "").includes("/login"));
});

test("middleware allows a valid site-password session", async () => {
  const token = await createSessionToken(process.env.AUTH_SECRET!);
  const req = new NextRequest("https://example.com/api/_diag/supabase-project", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  const res = await middleware(req);
  assert.equal(res.status, 200, "a valid session cookie must be allowed through the gate");
});

test("diag route is NOT in the public exclusion list (so it is session-protected)", () => {
  const matcher = middlewareConfig.matcher[0] as string;
  assert.ok(
    !matcher.includes("api/_diag"),
    "the diag route must not be whitelisted as a public route; the session gate must cover it"
  );
});

test("verifySessionToken denies a missing token and a token signed with a different secret (fail closed)", async () => {
  assert.equal(await verifySessionToken(process.env.AUTH_SECRET!, null), false);
  assert.equal(await verifySessionToken(process.env.AUTH_SECRET!, undefined), false);
  // A well-formed token signed with a different secret must be rejected.
  const otherToken = await createSessionToken("a-different-secret");
  assert.equal(await verifySessionToken(process.env.AUTH_SECRET!, otherToken), false);
});

test("projectRefFromUrl extracts only the supabase hostname/ref", () => {
  assert.equal(projectRefFromUrl("https://wcrcllhvgbhykbonopzx.supabase.co"), "wcrcllhvgbhykbonopzx");
  assert.equal(projectRefFromUrl("https://abcdefghijklm.supabase.co/rest/v1/"), "abcdefghijklm");
  assert.equal(projectRefFromUrl("https://custom.example.com"), null);
  assert.equal(projectRefFromUrl("not a url"), null);
});

test("GET returns only the project reference, never a key/token/full URL", async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://wcrcllhvgbhykbonopzx.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-key-value";
  try {
    const res = await GET();
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { ok: true, projectRef: "wcrcllhvgbhykbonopzx" });
    const body = JSON.stringify(json);
    assert.ok(!body.includes("secret-key-value"), "must not leak the service-role key");
    assert.ok(!body.includes("eyJhbGci"), "must not leak a JWT-like value");
    assert.ok(!body.includes("supabase.co/rest"), "must not leak the full URL path");
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test("GET fails closed (500) when SUPABASE_URL is not a supabase host", async () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://custom.example.com";
  try {
    const res = await GET();
    assert.equal(res.status, 500);
  } finally {
    if (prev === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prev;
  }
});
