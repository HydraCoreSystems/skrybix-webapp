# Skrybix - Claude Code Handoff Brief

Context for picking this project up in Claude Code. Paste this whole file into
the chat when you start the project, and attach the three files listed at the
bottom under "Reference material."

## What Skrybix is

A plant nursery inventory + label-printing system for a Hoya collection (the
business also sells cuttings). Currently built as a Google Sheet + one large
Apps Script file, developed over several months. The goal now is to migrate
it to a real web app, following the same successful pattern as two other
Sheets-to-web conversions already done in Claude Code.

## Core data model (validated, carries over directly)

- **Mother_Plants** - the source-of-truth record for each physical mother
  plant: Mother_ID, Display_Name, Location, and structured naming fields:
  Genus, Species, Qualifier (blank / "aff." / "cf." / "sp."), Collection_Code
  (used with Qualifier="sp."), Cultivar, Trade_Name, Hybrid (boolean).
- **Cuttings** - cuttings taken from a mother plant. Cutting_ID format is
  `{Mother_ID}-C{seq}` (e.g. `M014-C01`), generated from a persistent,
  never-reused counter per mother (critical: do NOT regenerate IDs by
  scanning existing rows for a max value - that scheme breaks the moment a
  row is ever archived or deleted, which happens routinely once cuttings are
  sold). Cuttings are either active (in stock) or sold.
- **Outgoing_Log** - a sales/disposal ledger. When a cutting is sold, it
  should be logged here AND removed from the active cuttings view (archived,
  not hard-deleted) so "how many do I have" counts stay accurate.
- **Hoya_Species** - a reference/checklist tab already built and populated
  with 563 rows, sourced from Kew's Plants of the World Online (POWO).
  Columns: Genus, Species, In_Collection (Y/blank), Date_Added,
  Preferred_ID_Code (a short species code, e.g. "ALAG" for alagensis - used
  to build Mother_IDs like ALAG-001), Native_Range, Region_Group,
  Growth_Habit, Leaf_Notes, Bloom_Notes, Authority, Notes, Source, Unique_ID.
  Behavior: the first time a species appears in Mother_Plants, In_Collection
  gets marked Y and Date_Added gets set - and it should NEVER un-mark
  automatically even if every plant of that species is later sold (it's a
  "have I ever owned this" flag, not a live inventory count).

## Botanical naming rules (already validated against the user's reference doc)

The user has a "Hoya Naming Convention Quick Reference Guide" - ask for it if
not attached. Key rules already implemented and tested in the Sheets version:

- Genus + Species are italicized; everything else (qualifiers, cultivar
  quotes, trade name quotes, the x hybrid symbol) is not.
- Normal: "Hoya carnosa" (genus capitalized, species forced lowercase
  regardless of how it's typed).
- Cultivar: 'Single quotes', capitalized.
- Trade name: "Double quotes" (curly quotes in the reference doc).
- Hybrid: "Hoya x spathulata" (x with spaces, not italicized).
- Uncertain ID: "Hoya aff. lacunosa" / "Hoya cf. lacunosa".
- Unidentified: "Hoya sp. GPS 4042" (qualifier + collection code, no italics
  on either).

This composition logic is fully implemented and tested in
`Skrybix_FIXED_v2.gs` (see `composeHoyaBotanicalLine1_` /
`composeHoyaLine2_`) - worth porting the logic directly rather than
re-deriving it.

## Open decisions to make at kickoff

1. **Data migration**: import the user's real current Sheets data (Mother_Plants,
   the 563-row Hoya_Species list, existing cuttings, Outgoing_Log history) on
   day one, or start with empty tables and bring data over later? Ask the user.
2. **V1 scope**: bare core workflow (mother plants / cuttings / sold /
   outgoing log / CSV label export) vs. also including the Hoya naming +
   species-tracker automation vs. also tackling label printing in the first
   pass. Ask the user - they were leaning toward core workflow first, then
   deciding.
3. **Stack**: user is open to Supabase (hosted Postgres) for the database.
   Framework/hosting otherwise unconstrained - match whatever pattern worked
   for their other two Claude Code conversions if that's established, or
   default to something conventional (e.g. Next.js + Supabase).

## Label printing context (unresolved, lower priority)

The user currently prints labels via a Brother PT-P710BT: check boxes in the
Sheet, export a CSV, open it in Brother's P-touch Editor (which has a saved
mail-merge template), print manually. A long debugging session this
afternoon tried to fully automate printing via Brother's b-PAC COM SDK from
PowerShell and hit real, confirmed technical walls (late-bound COM parameter
marshaling issues with `GetText`/output parameters; several core properties
returning null immediately after opening a template - likely needs a
printer/media association set first, unconfirmed). That path is not
recommended to continue down blindly.

Alternative discussed: a Zebra ZD411 (~$322 for the plain USB direct-thermal
model) using ZPL, a plain-text printer language with well-documented, simple
raw-command printing (no proprietary SDK, official Zebra APIs for exactly
this). Recommended over cheaper ZPL-labeled clones (Rollo, MUNBYN, etc.)
specifically because Zebra's raw-command automation path is confirmed
documented, and the user has explicitly prioritized reliability over saving
$150-250. No purchase has been made yet - this is worth revisiting once the
core web app exists, either as a native app feature (generate ZPL server-side,
send to a networked/USB Zebra) or left as a manual step for longer.

## Known bugs already fixed in the Sheets version (context, not necessarily
## relevant to the rebuild, but explains some "why" decisions above)

- CSV exports were not comma/quote-escaping fields, corrupting labels when
  plant names contained commas.
- QR codes on new cuttings were copying a hardcoded value from row 2 instead
  of being derived per-mother - likely means labels printed to date may have
  linked to the wrong plant.
- Cutting ID generation reused numbers after rows were deleted/archived
  (root cause for the "persistent counter, never re-derive from a scan" rule
  above).
- Bulk-edited rows (paste/fill-down) were only partially synced due to an
  onEdit handler only processing the first row of a multi-row edit.

Full detail on all of this is in the attached review doc, mostly for
historical "why does this business logic exist" context - the web rebuild
doesn't need to replicate the Sheets/Apps Script architecture itself.

## Reference material to attach in Claude Code

1. `skrybix_web.zip` - a working Flask/SQLite prototype built and tested
   earlier today, covering the core workflow end-to-end (add mother plants,
   take cuttings with auto-generated IDs, mark sold, push to outgoing log,
   CSV/PDF label export with real per-item QR codes). Not meant to be the
   final stack necessarily, but a proven reference for the data model and
   flow.
2. `Skrybix_FIXED_v2.gs` - the current (Sheets-side) source of truth for the
   Hoya naming composition logic, ID generation rules, and species-tracker
   behavior described above.
3. `Skrybix_Review_and_Roadmap.docx` - full write-up of the original system,
   bugs found/fixed, and the case for moving to a web app in the first place.
