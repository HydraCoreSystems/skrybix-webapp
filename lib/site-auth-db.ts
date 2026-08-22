import { getSupabaseServerClient } from "@/lib/supabase";

export async function getPasswordHash(): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("site_auth").select("password_hash").eq("id", 1).maybeSingle();
  // A failed read must not look like "no password row exists yet" -- the
  // caller (changePassword) previously treated both cases identically as
  // "current password incorrect," which is a believable but wrong failure
  // mode for a DB outage during a password change.
  if (error) {
    throw new Error(`Unable to read the site password: ${error.message}`);
  }
  return data?.password_hash ?? null;
}

export async function setPasswordHash(hash: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("site_auth")
    .upsert({ id: 1, password_hash: hash, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
