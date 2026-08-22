// TEMPORARY production diagnostic — determine the live Supabase project
// reference from inside the running application.
//
// Reads SUPABASE_URL at runtime and returns ONLY the Supabase hostname /
// project reference (the `<ref>.supabase.co` subdomain). It never returns a
// service-role key, token, password, or full connection string.
//
// This route is protected by the application's existing site-password session
// gate (see middleware.ts): it is intentionally NOT listed in the public
// exclusion list, so an unauthenticated request is redirected to /login and
// returns no data. Only an authenticated (logged-in) user can read it.
//
// Remove this route (and this comment) once the project reference has been
// recorded and the URL is confirmed to 404.

export const runtime = "nodejs";

/**
 * Extracts just the Supabase project reference (the subdomain before
 * `.supabase.co`) from a SUPABASE_URL. Returns null for a non-Supabase host
 * or a malformed URL, so the route can never leak an arbitrary hostname.
 */
export function projectRefFromUrl(url: string): string | null {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
  return match ? match[1] : null;
}

export async function GET() {
  const url = process.env.SUPABASE_URL ?? "";
  const ref = projectRefFromUrl(url);
  if (!ref) {
    return Response.json(
      { ok: false, error: "SUPABASE_URL is not a supabase host" },
      { status: 500 }
    );
  }
  return Response.json({ ok: true, projectRef: ref });
}
