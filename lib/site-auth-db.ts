import { getSupabaseServerClient } from "@/lib/supabase";

export async function getPasswordHash(): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("site_auth").select("password_hash").eq("id", 1).maybeSingle();
  return data?.password_hash ?? null;
}

export async function setPasswordHash(hash: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("site_auth")
    .upsert({ id: 1, password_hash: hash, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
