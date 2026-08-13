import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

// Supabase's free tier auto-pauses a project after ~7 days with no API
// activity -- that's what actually broke login once (not a code change):
// the DB was unreachable, so the login action's generic failure path made
// it look like a wrong password. A Vercel Cron hitting this route keeps
// real traffic flowing so the project never goes quiet long enough to
// pause. Does a real (tiny) query, not just a ping, since Supabase counts
// API/DB activity, not raw HTTP hits to the Vercel edge.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("site_auth").select("id").eq("id", 1).maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
}

export const dynamic = "force-dynamic";
