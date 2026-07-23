# Skrybix — Plant Nursery Inventory Web App

## What this project is

Skrybix is a plant nursery inventory + label-printing system for a Hoya
collection (the business also sells cuttings). Originally built as a
Google Sheet + one large Apps Script file, developed over several months.
The goal is to migrate it to a real web app, following the same pattern
already used successfully for two other Sheets-to-web conversions
(`gm-money-webapp`, `hydrocloud-webapp` — sibling projects on this
machine).

## Current state (as of 2026-07-22)

This repo was seeded from a working Flask + SQLite **prototype** (built in
a prior session, see `reference/Skrybix_Review_and_Roadmap.docx` §4) that
proves the core workflow end-to-end:

```
Mother Plants --(take cuttings)--> Cuttings --(sold)--> Outgoing Log
                                       |
                                       +--> printable labels (CSV + PDF, real per-item QR codes)
```

- `app.py` — Flask routes + SQLite schema (mother_plants, cuttings,
  outgoing_log tables)
- `templates/` — server-rendered Jinja templates for every page
- `requirements.txt` — flask, qrcode, reportlab, pillow
- `reference/` — the original handoff brief, the Sheets-side Apps Script
  source of truth (`Skrybix_FIXED_v2.gs`), and the full review/roadmap
  doc. Read these for "why" context on business logic below — don't
  replicate the Sheets/Apps Script architecture itself, just the rules.

This prototype is explicitly **not production** yet: no auth, no
deployment config, no data import from the real Sheet, and it's missing
the Hoya structured-naming automation and species tracker that exist in
the Sheets version. See "Not yet built" below.

**Confirmed 2026-07-22: `Skrybix_FIXED_v2.gs` is the script actually
running in the live spreadsheet right now**, not just a proposed patch —
the owner ran "One-time Setup (v2 columns/tabs)". This means the real
`Mother_Plants` tab already has the structured naming columns
(Genus/Species/Qualifier/Collection_Code/Cultivar/Trade_Name/Hybrid)
populated with real data, and real `ID_Counters` / `Archive_Cuttings` /
`Hoya_Species` (563-row POWO list) tabs exist with live data — this is
not a hypothetical future shape, it's what any data-import script needs
to target today.

## Core data model (validated — do not change without good reason)

- **Mother_Plants** — source-of-truth record for each physical mother
  plant: Mother_ID, Display_Name, Location, and (in the Sheets version,
  not yet in the prototype) structured naming fields: Genus, Species,
  Qualifier (blank / "aff." / "cf." / "sp."), Collection_Code (used with
  Qualifier="sp."), Cultivar, Trade_Name, Hybrid (boolean).
- **Cuttings** — cuttings taken from a mother plant. Cutting_ID format is
  `{Mother_ID}-C{seq}` (e.g. `M014-C01`), generated from a **persistent,
  never-reused counter per mother**. Do NOT regenerate IDs by scanning
  existing rows for a max value — that scheme breaks the moment a row is
  ever archived or deleted, which happens routinely once cuttings sell.
  (The prototype currently scans for max — see "Known prototype
  shortcuts" below, this needs fixing before it's trustworthy.)
- **Outgoing_Log** — sales/disposal ledger. When a cutting sells, it's
  logged here and removed from the active cuttings view (archived, not
  hard-deleted) so "how many do I have" stays accurate.
- **Hoya_Species** (not yet in the prototype) — a reference/checklist,
  563 rows sourced from Kew's POWO. Columns: Genus, Species,
  In_Collection (Y/blank), Date_Added, Preferred_ID_Code (short species
  code, e.g. "ALAG" → Mother_IDs like `ALAG-001`), Native_Range,
  Region_Group, Growth_Habit, Leaf_Notes, Bloom_Notes, Authority, Notes,
  Source, Unique_ID. In_Collection gets marked Y and Date_Added set the
  first time a species appears in Mother_Plants — and must **never
  un-mark automatically** even if every plant of that species is later
  sold (it's a "have I ever owned this" flag, not a live count).

## Botanical naming rules (implemented in Sheets, NOT yet ported to the web app)

Reference: `reference/Skrybix_FIXED_v2.gs`, functions
`composeHoyaBotanicalLine1_` / `composeHoyaLine2_`. Port this logic
directly rather than re-deriving it — it's already tested.

- Genus + Species are italicized; qualifiers, cultivar quotes, trade name
  quotes, and the × hybrid symbol are not.
- Normal: "Hoya carnosa" (genus capitalized, species forced lowercase).
- Cultivar: 'Single quotes', capitalized.
- Trade name: "Double quotes" (curly quotes).
- Hybrid: "Hoya × spathulata" (× with spaces, not italicized).
- Uncertain ID: "Hoya aff. lacunosa" / "Hoya cf. lacunosa".
- Unidentified: "Hoya sp. GPS 4042" (qualifier + collection code, no
  italics on either).

If a "Hoya Naming Convention Quick Reference Guide" doc isn't in
`reference/`, ask the owner for it before touching naming logic.

## Known prototype shortcuts (fixed in Sheets, need re-fixing here before trusting)

The prototype in `app.py` was a fast proof-of-concept and reintroduced
one of the bugs already solved on the Sheets side:

- `next_cutting_seq()` in `app.py` computes the next Cutting_ID by
  scanning existing `cuttings` rows for the max sequence per mother —
  this is the exact bug pattern `Skrybix_FIXED_v2.gs` fixed with a
  persistent `ID_Counters`-style table, precisely because scanning breaks
  once sold cuttings get archived/removed and are no longer there to
  scan. Replace with a persistent counter (e.g. a `mother_seq` table:
  mother_id, next_seq) before relying on this for real inventory.
- `push_sold()` in `app.py` clears the `sold` flag but leaves rows in the
  active `cuttings` table — it does not archive/remove them the way
  `Skrybix_FIXED_v2.gs`'s `archiveAndRemoveCuttingRows_` does. Active
  cutting counts will over-count sold stock until this is fixed.

## Not yet built (from the brief's open scope decisions)

1. Hoya structured naming entry + auto-composition (Genus/Species/
   Qualifier/Collection_Code/Cultivar/Trade_Name/Hybrid → Botanical
   Line1/Line2).
2. Hoya_Species reference tab / species tracker (563-row POWO list,
   In_Collection auto-marking).
3. Persistent, collision-free ID counters (see "Known prototype
   shortcuts" above).
4. Data migration from the real Google Sheet (Mother_Plants,
   Hoya_Species, existing Cuttings, Outgoing_Log history).
5. Auth / multi-user, real hosting, production database, automated
   backups (roadmap doc calls this "Tier 2").
6. Label printer integration — currently PDF/CSV export only, printed
   manually. See `reference/Skrybix_ClaudeCode_Handoff_Brief.md` for the
   Brother PT-P710BT vs. Zebra ZD411/ZPL discussion — no printer has been
   purchased yet, this is a deliberately deferred decision.

Ask the owner before starting on any of these — scope order hasn't been
confirmed yet.

## What NOT to do

- Do not replicate the Sheets/Apps Script architecture itself when
  porting logic — only the business rules (naming, ID generation,
  archiving, species tracking) need to carry over.
- Do not regenerate Cutting_ID or Mother_ID by scanning existing rows for
  a max value — always use a persistent, never-reused counter.
- Do not let In_Collection on Hoya_Species un-mark automatically.
- Do not build the full label-printer pipeline before the owner has
  decided on hardware (Zebra ZD411 was the recommended direction, not yet
  purchased).
