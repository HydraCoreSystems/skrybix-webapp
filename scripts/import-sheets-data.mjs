// One-time migration: import real data exported from the live Google
// Sheet into Supabase. Run with: node scripts/import-sheets-data.mjs
//
// Expects CSV exports (exact Sheets tab -> file mapping) in data/sheets-export/:
//   Mother_Plants        -> mother_plants.csv
//   Hoya_Species         -> hoya_species.csv
//   Label_Data_Cuttings  -> label_data_cuttings.csv   (active cuttings)
//   Archive_Cuttings     -> archive_cuttings.csv       (sold/archived cuttings)
//   Outgoing_Log         -> outgoing_log.csv
//   ID_Counters          -> id_counters.csv            (optional but recommended)
//
// Only mother_plants.csv is strictly required to run at all; the rest are
// skipped with a warning if missing. Safe to re-run: everything upserts on
// primary key, so a second run just overwrites rows with the same data.
//
// See CLAUDE.md "Architecture decisions" for why the target schema looks
// the way it does (soft-archive column instead of a second table, atomic
// counter function instead of a lock-serviced counter sheet).

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data", "sheets-export");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  const env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      })
  );
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  }
  return env;
}

function readCsv(filename) {
  const filePath = path.join(dataDir, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8");
  return parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

function truthy(v) {
  return String(v || "").trim().toUpperCase() === "TRUE" || String(v || "").trim().toUpperCase() === "Y";
}

function nullIfBlank(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function normalizeQualifier(q) {
  const v = String(q || "").trim().toLowerCase().replace(/\.+$/, "");
  if (v === "aff") return "aff.";
  if (v === "cf") return "cf.";
  if (v === "sp") return "sp.";
  return "";
}

// Cutting_ID format is {Mother_ID}-C{seq} — Mother_ID itself may contain a
// hyphen (species-code IDs like ALAG-001), so anchor on the LAST -C<digits>
// suffix rather than the first hyphen.
function parseCuttingId(cuttingId) {
  const m = String(cuttingId || "").match(/^(.+)-C(\d+)$/);
  if (!m) return null;
  return { motherId: m[1], seq: parseInt(m[2], 10) };
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const motherRows = readCsv("mother_plants.csv");
  if (!motherRows) {
    console.error("data/sheets-export/mother_plants.csv not found — nothing to import. Aborting.");
    process.exit(1);
  }

  const speciesRows = readCsv("hoya_species.csv");
  const activeCuttingRows = readCsv("label_data_cuttings.csv");
  const archivedCuttingRows = readCsv("archive_cuttings.csv");
  const outgoingRows = readCsv("outgoing_log.csv");
  const counterRows = readCsv("id_counters.csv");

  const report = { warnings: [], counts: {} };

  // ---- mother_plants ----
  const motherIds = new Set();
  const mothersToInsert = motherRows.map((r) => {
    const motherId = String(r.Mother_ID || "").trim();
    motherIds.add(motherId);
    return {
      mother_id: motherId,
      display_name: String(r.Display_Name || "").trim(),
      location: nullIfBlank(r.Location),
      genus: nullIfBlank(r.Genus) || "Hoya",
      species: nullIfBlank(r.Species),
      qualifier: normalizeQualifier(r.Qualifier),
      collection_code: nullIfBlank(r.Collection_Code),
      cultivar: nullIfBlank(r.Cultivar),
      trade_name: nullIfBlank(r.Trade_Name),
      hybrid: truthy(r.Hybrid),
      botanical_line1: nullIfBlank(r.Botanical_Line1),
      botanical_line2: nullIfBlank(r.Botanical_Line2),
      print_label: false,
    };
  });

  {
    const { error } = await supabase.from("mother_plants").upsert(mothersToInsert, { onConflict: "mother_id" });
    if (error) throw new Error("mother_plants insert failed: " + error.message);
    report.counts.mother_plants = mothersToInsert.length;
  }

  // ---- hoya_species ----
  if (speciesRows) {
    const speciesToInsert = speciesRows.map((r) => ({
      genus: nullIfBlank(r.Genus) || "Hoya",
      species: String(r.Species || "").trim(),
      in_collection: truthy(r.In_Collection),
      date_added: nullIfBlank(r.Date_Added),
      preferred_id_code: nullIfBlank(r.Preferred_ID_Code),
      native_range: nullIfBlank(r.Native_Range),
      region_group: nullIfBlank(r.Region_Group),
      growth_habit: nullIfBlank(r.Growth_Habit),
      leaf_notes: nullIfBlank(r.Leaf_Notes),
      bloom_notes: nullIfBlank(r.Bloom_Notes),
      authority: nullIfBlank(r.Authority),
      notes: nullIfBlank(r.Notes),
      source: nullIfBlank(r.Source),
      unique_id: nullIfBlank(r.Unique_ID),
    }));
    // hoya_species has no natural single-column primary key in the sheet
    // (Unique_ID isn't guaranteed populated) — delete-and-reinsert on
    // lower(species) instead of upsert, since re-running this script should
    // fully replace the reference list, not accumulate duplicates.
    const { error: delErr } = await supabase.from("hoya_species").delete().neq("id", -1);
    if (delErr) throw new Error("hoya_species clear failed: " + delErr.message);
    const { error } = await supabase.from("hoya_species").insert(speciesToInsert);
    if (error) throw new Error("hoya_species insert failed: " + error.message);
    report.counts.hoya_species = speciesToInsert.length;
  } else {
    report.warnings.push("hoya_species.csv not found — skipped (species tracker will be empty).");
  }

  // ---- cuttings (active + archived combined) ----
  const cuttingRows = [
    ...(activeCuttingRows || []).map((r) => ({ ...r, __archived: null })),
    ...(archivedCuttingRows || []).map((r) => ({ ...r, __archived: r.Archived_Date || new Date().toISOString() })),
  ];

  const cuttingsToInsert = [];
  const importedCuttingIds = new Set();
  const maxSeqByMother = {};

  for (const r of cuttingRows) {
    const cuttingId = String(r.Cutting_ID || "").trim();
    const parsed = parseCuttingId(cuttingId);
    if (!parsed) {
      report.warnings.push(`Skipped cutting row with unparseable Cutting_ID: "${cuttingId}"`);
      continue;
    }
    if (!motherIds.has(parsed.motherId)) {
      report.warnings.push(`Skipped cutting "${cuttingId}" — Mother_ID "${parsed.motherId}" not found in mother_plants.csv`);
      continue;
    }
    if (importedCuttingIds.has(cuttingId)) continue; // dedupe if a row appears in both active+archive by mistake

    importedCuttingIds.add(cuttingId);
    maxSeqByMother[parsed.motherId] = Math.max(maxSeqByMother[parsed.motherId] || 0, parsed.seq);

    cuttingsToInsert.push({
      cutting_id: cuttingId,
      mother_id: parsed.motherId,
      full_display_name: nullIfBlank(r.Full_Display_Name),
      label_line1: nullIfBlank(r.Label_Line1),
      label_line2: nullIfBlank(r.Label_Line2),
      date_taken: nullIfBlank(r.Date_Taken),
      sold: truthy(r.Sold),
      print_label: false,
      archived_at: r.__archived,
    });
  }

  if (cuttingsToInsert.length) {
    const { error } = await supabase.from("cuttings").upsert(cuttingsToInsert, { onConflict: "cutting_id" });
    if (error) throw new Error("cuttings insert failed: " + error.message);
  }
  report.counts.cuttings = cuttingsToInsert.length;
  if (!activeCuttingRows) report.warnings.push("label_data_cuttings.csv not found — no active cuttings imported.");
  if (!archivedCuttingRows) report.warnings.push("archive_cuttings.csv not found — no archived/sold cuttings imported.");

  // ---- outgoing_log ----
  if (outgoingRows) {
    const outgoingToInsert = [];
    const synthesizedCuttings = [];

    for (const r of outgoingRows) {
      const cuttingId = String(r.Cutting_ID || "").trim();
      if (!cuttingId) continue;

      if (!importedCuttingIds.has(cuttingId)) {
        // Historical outgoing_log entry whose cutting row no longer exists
        // in either Label_Data_Cuttings or Archive_Cuttings (Sheets-era
        // manual edits). Synthesize a minimal archived cutting row so the
        // outgoing_log foreign key is satisfiable and the sale record isn't
        // silently dropped.
        const parsed = parseCuttingId(cuttingId);
        if (parsed && motherIds.has(parsed.motherId)) {
          synthesizedCuttings.push({
            cutting_id: cuttingId,
            mother_id: parsed.motherId,
            full_display_name: nullIfBlank(r.Full_Display_Name),
            sold: true,
            print_label: false,
            archived_at: new Date().toISOString(),
          });
          importedCuttingIds.add(cuttingId);
          report.warnings.push(`Synthesized missing cutting row for outgoing_log entry "${cuttingId}" (not found in cuttings sheets).`);
        } else {
          report.warnings.push(`Skipped outgoing_log row — cutting "${cuttingId}" has no matching mother and couldn't be synthesized.`);
          continue;
        }
      }

      outgoingToInsert.push({
        date_out: nullIfBlank(r.Date_Out) || new Date().toISOString().slice(0, 10),
        cutting_id: cuttingId,
        full_display_name: nullIfBlank(r.Full_Display_Name),
        qty: Number(r.Qty || 1) || 1,
        reason: nullIfBlank(r.Reason),
        selling_platform: nullIfBlank(r.Selling_Platform),
        notes: nullIfBlank(r.Notes),
      });
    }

    if (synthesizedCuttings.length) {
      const { error } = await supabase.from("cuttings").upsert(synthesizedCuttings, { onConflict: "cutting_id" });
      if (error) throw new Error("synthesized cuttings insert failed: " + error.message);
    }

    if (outgoingToInsert.length) {
      // outgoing_log has no natural unique key from the sheet — clear and
      // reinsert full history on each run rather than risk duplicating rows.
      const { error: delErr } = await supabase.from("outgoing_log").delete().neq("id", -1);
      if (delErr) throw new Error("outgoing_log clear failed: " + delErr.message);
      const { error } = await supabase.from("outgoing_log").insert(outgoingToInsert);
      if (error) throw new Error("outgoing_log insert failed: " + error.message);
    }
    report.counts.outgoing_log = outgoingToInsert.length;
    report.counts.synthesized_cuttings = synthesizedCuttings.length;
  } else {
    report.warnings.push("outgoing_log.csv not found — skipped.");
  }

  // ---- mother_cutting_counters ----
  // Seed each mother's counter to the higher of (a) the live ID_Counters
  // sheet's Next_Number and (b) 1 + the highest sequence actually found in
  // imported cutting IDs — so a newly generated ID can never collide with
  // a historical one even if ID_Counters.csv was slightly stale.
  const counterFromSheet = {};
  if (counterRows) {
    for (const r of counterRows) {
      const key = String(r.Key || "");
      const m = key.match(/^CUTSEQ::(.+)$/);
      if (m) counterFromSheet[m[1]] = Number(r.Next_Number || 1);
    }
  } else {
    report.warnings.push("id_counters.csv not found — seeding counters from imported cutting IDs only.");
  }

  const counterUpserts = [...motherIds]
    .map((motherId) => {
      const fromSheet = counterFromSheet[motherId] || 1;
      const fromData = (maxSeqByMother[motherId] || 0) + 1;
      return { mother_id: motherId, next_seq: Math.max(fromSheet, fromData) };
    })
    .filter((c) => c.next_seq > 1); // no need to seed a row for mothers with no cuttings yet

  if (counterUpserts.length) {
    const { error } = await supabase.from("mother_cutting_counters").upsert(counterUpserts, { onConflict: "mother_id" });
    if (error) throw new Error("mother_cutting_counters insert failed: " + error.message);
  }
  report.counts.mother_cutting_counters = counterUpserts.length;

  console.log("Import complete.");
  console.log("Counts:", report.counts);
  if (report.warnings.length) {
    console.log(`\n${report.warnings.length} warning(s):`);
    report.warnings.forEach((w) => console.log(" - " + w));
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
