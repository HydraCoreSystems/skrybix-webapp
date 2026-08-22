import HoyaLibrary from "./HoyaLibrary";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { HoyaSpeciesRecord } from "@/lib/hoya-library";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function HoyaLibraryPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string };
}) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("hoya_species").select("*").order("species");
  if (error) throw new Error(`Unable to load the Hoya library: ${error.message}`);

  return (
    <div className="hoya-library-page">
      {searchParams.success && <div className="flash success">{searchParams.success}</div>}
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <HoyaLibrary records={(data ?? []) as HoyaSpeciesRecord[]} />
      <p className="library-source-note">
        Reference data is a stored POWO/Kew-derived snapshot, not a live Kew feed. Collection status means a species has been
        recorded as owned at least once; it is intentionally not removed when an individual plant leaves the collection.
      </p>
    </div>
  );
}
