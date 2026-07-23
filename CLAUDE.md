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

Rebuilt on **Next.js 14 (App Router) + TypeScript + Supabase (Postgres)**
— the same stack `hydrocloud-webapp` already landed on, chosen explicitly
to match that established pattern (owner asked for "whatever platform...
gives the most options"). This replaced an earlier Flask + SQLite
prototype, now preserved at `reference/flask_prototype/` for history —
its job (prove the workflow was feasible) is done; don't build on it.

```
Mother Plants --(take cuttings)--> Cuttings --(sold)--> Outgoing Log
                                       |
                                       +--> printable labels (CSV export + browser-printed QR label sheets)
```

Implemented, type-checks/builds clean, **and verified end-to-end against
the real production Supabase database** (2026-07-23): real data migrated
(147 mother plants, 563 Hoya species, 1066 cuttings, 28 outgoing log
entries — see "Data migration" below), dashboard/mothers/cuttings/outgoing
pages all confirmed showing correct real counts via direct DB queries and
cache-busting fetches of the live server (not just eyeballing the UI — the
Browser preview tool served a stale cached page mid-verification that
looked like a real bug and wasn't one, see git log for the full story).

**Deployed and live** at https://skrybix-webapp.vercel.app (Vercel project
`gathering-moss/skrybix-webapp`), **password-protected** via HTTP Basic
Auth in `middleware.ts` — server-enforced on every request (see
`middleware.ts`'s comment for why that matters), fails closed if
`SITE_PASSWORD` isn't set. This is a pragmatic first step, same framing as
GM Money's own auth decision — real Supabase Auth accounts are the
eventual target if/when multi-user access matters, not a permanent
ceiling. Env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SITE_URL`, `SITE_PASSWORD`) are set in Vercel's Production environment
via `vercel env add` — check with `vercel env ls`, don't assume `.env.local`
is the only place they live.

- `app/` — Next.js App Router pages + Server Actions (`actions.ts` per
  route group) + API routes for CSV export
- `lib/supabase.ts` — server-only Supabase client (`SUPABASE_SERVICE_ROLE_KEY`,
  never exposed to the browser — no RLS policies needed since nothing
  queries Supabase client-side)
- `lib/csv.ts`, `lib/qr.ts`, `lib/types.ts` — shared helpers
- `supabase/schema.sql` — full Postgres schema, run once against a real
  Supabase project (see below)
- `components/Nav.tsx`, `components/PrintButton.tsx`
- `reference/` — handoff brief, live Apps Script source of truth
  (`Skrybix_FIXED_v2.gs`), the review/roadmap doc, and the archived Flask
  prototype. Read these for "why" context — don't replicate the Sheets/
  Apps Script *architecture*, just the *business rules*.

**Confirmed 2026-07-22: `Skrybix_FIXED_v2.gs` is the script actually
running in the live spreadsheet**, not just a proposed patch — the owner
ran "One-time Setup (v2 columns/tabs)". The real `Mother_Plants` tab
already has the structured naming columns populated with real data, and
real `ID_Counters` / `Archive_Cuttings` / `Hoya_Species` (563-row POWO
list) tabs exist with live data. `supabase/schema.sql` already has columns
for all of this (see below) — the naming-automation *UI* isn't wired up
yet, but the schema isn't a hypothetical future shape, it matches what the
owner's real data already looks like today.

## Local setup (Supabase project already exists — "Gathering Moss" / "Skrybix", production tier)

1. Get `SUPABASE_URL` and the `service_role` secret key (NOT `anon`) from
   the owner or the Supabase dashboard (Project Settings → API).
2. Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `SITE_URL` (leave as
   `http://localhost:3000` for local dev; **must** be updated to the real
   deployed domain before printing any label for real, since QR codes are
   generated from this value). `.env.local` is gitignored — never commit
   it, it holds a real secret.
3. `npm install && npm run dev`.

Note from 2026-07-23: multiple `next dev` processes were left orphaned
across sessions (background task stop didn't always kill the underlying
OS process, since `npm run dev` spawns a child `next` process). If
`localhost:3000` behaves strangely or shows stale data, check
`netstat -ano | grep LISTENING` for stray processes on 3000-3002 and
`taskkill //F //PID <pid>` them before assuming it's a real bug.

## Data migration (done 2026-07-23 — script is safe to re-run for future updates)

`scripts/import-sheets-data.mjs` imports CSV exports of the real Sheet
tabs (see `data/sheets-export/README.md` for exact filenames/instructions)
into Supabase. Real counts as of the first run: 147 mother plants, 563
Hoya species, 1066 cuttings (1038 active / 28 sold+archived), 28 outgoing
log entries.

**Important lesson from this migration, worth remembering for any future
Sheets-reading work**: the reference `Skrybix_FIXED_v2.gs` file's column
names do NOT fully match the live sheet — see "Core data model" below for
what's actually real. Don't trust that file's constants (`COL_QUALIFIER`,
`COL_COLLECTION_CODE`, etc.) as ground truth for the live spreadsheet
without checking an actual export first. Also: the sheet has ~847 blank
template rows (data validation applied to a wide range, no real content)
mixed into `Mother_Plants`'s 995 total rows — only rows with a non-blank
`Display_Name` are real plants (147 of the 148 real rows have a
`Mother_ID`; one stray row has neither and gets skipped).

## Architecture decisions made porting Sheets → Postgres (adaptations, not scope changes)

- **`ID_Counters` → `mother_cutting_counters` + `next_cutting_seq()`**: an
  atomic Postgres UPSERT (`supabase/schema.sql`) replaces Apps Script's
  `LockService` + manual read/write. Same guarantee — persistent,
  never-reused, collision-free per mother — safer implementation, and this
  is what `app/cuttings/actions.ts`'s `createCuttings()` calls. **Never**
  regenerate a Cutting_ID or Mother_ID by scanning existing rows for a max
  value.
- **`Archive_Cuttings` → `cuttings.archived_at`**: a soft-archive
  timestamp column instead of a second table + physical row move. Same
  guarantee (archived rows drop out of "active" queries via `.is
  ("archived_at", null)`, nothing is hard-deleted, full row data
  preserved) via one WHERE clause instead of copy+delete.
  `pushSoldToOutgoingLog()` in `app/cuttings/actions.ts` sets this.
- **PDF label export → browser-printed QR label sheets**: `app/labels/
  mothers/page.tsx` and `app/labels/cuttings/page.tsx` render a print
  stylesheet grid with real per-item QR codes (`qrcode` npm package,
  server-generated data URIs) instead of server-side PDF generation
  (`reportlab` in the old prototype). Same end result (a printable label
  sheet with real QR codes), avoids a heavyweight PDF-layout dependency.
  CSV export (`app/api/labels/*.csv/route.ts`) is unchanged in shape —
  still the file Brother's P-touch Editor mail-merge template consumes,
  per the owner's actual current physical-printing workflow.

## Known residual risk: Next.js version

`npm audit` flags a set of Next.js CVEs (DoS, cache poisoning, SSRF in
Server Actions/rewrites) whose advisory ranges only close at Next.js
16.x — they were never backported to the 14.x line, so even the latest
14.2.35 patch (used here) doesn't clear them. Fixing requires a real
major-version migration (Next 15 made `params`/`searchParams` async in
Server Components — a breaking API change across every page in this app),
which I deliberately did not do unverified mid-build. **`hydrocloud-webapp`
carries the identical exposure on an even older 14.2.5** — this is a
cross-project issue, not Skrybix-specific. Worth its own dedicated
follow-up (test the Next 16 migration properly, in both repos) rather than
folding into feature work.

## Core data model (validated against real exported data — do not change without good reason)

- **Mother_Plants** — source-of-truth record for each physical mother
  plant. The real live sheet's columns turned out to differ from what
  `Skrybix_FIXED_v2.gs` describes — both generations are in
  `supabase/schema.sql`'s `mother_plants` table:
  - **Actually used, real data on every row**: `genus`, `species`,
    `form_code` (e.g. "sp" — informal/unidentified marker),
    `name_type` ("Cultivar" / "Descriptor" / "Form" — says how to read
    `cultivar`), `cultivar` (holds a real cultivar name OR a collection
    code/descriptor depending on `name_type`), `natural_cultivar`
    (boolean), `display_name`, `botanical_line1`/`botanical_line2`
    (already fully composed, just copy on import — don't re-derive),
    `location`, `spec3` (3-letter species code embedded in Mother_ID,
    e.g. "ELL"), `mother_seq` (the numeric suffix, e.g. "01" — real
    Mother_IDs look like `HY-ELL01`, not the brief's `ALAG-001` example),
    `notes`, `species_key`/`species_key_2` (sheet-computed lookup keys
    against Hoya_Species), `flower_photo_link`.
  - **v2 columns from `Skrybix_FIXED_v2.gs`, present but blank on every
    real row as of the 2026-07-23 migration**: `qualifier`,
    `collection_code`, `trade_name`, `hybrid`. Kept in the schema in case
    they become real once naming-automation UI work starts, but don't
    assume they're populated or authoritative today.
- **Cuttings** — cuttings taken from a mother plant. Cutting_ID format is
  `{Mother_ID}-C{seq}` (e.g. `M014-C01`), generated via
  `next_cutting_seq()` — see "Architecture decisions" above.
- **Outgoing_Log** — sales/disposal ledger. When a cutting sells, it's
  logged here and archived out of the active cuttings view (not
  hard-deleted) so "how many do I have" stays accurate.
- **Hoya_Species** — schema exists (`hoya_species` table), 563-row POWO
  data import and the In_Collection auto-marking logic are not yet built.
  Columns: Genus, Species, In_Collection (Y/blank), Date_Added,
  Preferred_ID_Code (short species code, e.g. "ALAG" → Mother_IDs like
  `ALAG-001`), Native_Range, Region_Group, Growth_Habit, Leaf_Notes,
  Bloom_Notes, Authority, Notes, Source, Unique_ID. In_Collection must
  **never un-mark automatically** even if every plant of that species is
  later sold (it's a "have I ever owned this" flag, not a live count).

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

## Not yet built (from the brief's open scope decisions)

1. Hoya structured naming entry UI + auto-composition. **The naming
   composer functions in `Skrybix_FIXED_v2.gs`
   (`composeHoyaBotanicalLine1_`/`composeHoyaLine2_`) read from
   Qualifier/Collection_Code/Trade_Name/Hybrid — but real data lives in
   Form_Code/Name_Type/Cultivar/Natural_Cultivar instead** (see "Core data
   model" above). Don't port that composer logic as-is; it needs
   rewriting against the columns that are actually populated, or ask the
   owner which model should be authoritative going forward.
2. Hoya_Species In_Collection auto-marking on mother creation/edit — data
   itself is imported (563 rows), just not the auto-marking behavior.
3. ~~Data migration from the real Google Sheet~~ — **done 2026-07-23**,
   see "Data migration" above. Re-run `scripts/import-sheets-data.mjs`
   with fresh CSV exports if the Sheet changes significantly before a full
   cutover, but this is no longer a blocker.
4. ~~Real hosting deploy~~ — **done 2026-07-23**, live at
   https://skrybix-webapp.vercel.app. ~~Basic auth~~ — **done same day**,
   HTTP Basic Auth via `middleware.ts`. Still open: real multi-user
   accounts/roles (Supabase Auth) and automated backups (roadmap doc's
   "Tier 2" — Supabase gives real auth and hosted Postgres for free when
   this is ready).
5. Label printer integration — currently CSV export (Brother mail-merge)
   + browser-printed QR sheets, printed manually. See
   `reference/Skrybix_ClaudeCode_Handoff_Brief.md` for the Brother
   PT-P710BT vs. Zebra ZD411/ZPL discussion — no printer purchased yet,
   deliberately deferred.
6. Next.js 14→16 migration to clear the residual CVEs noted above
   (cross-project with `hydrocloud-webapp`).

Ask the owner before starting on any of these — scope order hasn't been
confirmed yet.

## What NOT to do

- Do not replicate the Sheets/Apps Script architecture itself when
  porting logic — only the business rules (naming, ID generation,
  archiving, species tracking) need to carry over.
- Do not regenerate Cutting_ID or Mother_ID by scanning existing rows for
  a max value — always go through `next_cutting_seq()`.
- Do not let In_Collection on Hoya_Species un-mark automatically.
- Do not build the full label-printer pipeline before the owner has
  decided on hardware (Zebra ZD411 was the recommended direction, not yet
  purchased).
- Do not query Supabase from client components with the anon key — all DB
  access goes through Server Components/Actions with the service role
  key. If real user accounts get built later, that's when RLS + a proper
  client-side auth flow becomes necessary, not before.
