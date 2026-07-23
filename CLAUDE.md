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

Implemented and locally build/type-check clean (`npx tsc --noEmit`,
`npx next build` both pass) — **not yet verified against a real database**,
see "What's blocking verification" below.

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

## What's blocking verification

**I cannot create a Supabase account/project myself** (account creation is
outside what I'm allowed to do unprompted) — the owner needs to:

1. Create a free project at supabase.com (no credit card required for the
   free tier).
2. In the Supabase dashboard, run the contents of `supabase/schema.sql`
   once (SQL Editor → paste → Run).
3. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_URL` — Project Settings → API → Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → `service_role`
     secret key (NOT the `anon` public key — this app does all DB access
     server-side with the service role key, so treat `.env.local` as a
     real secret, never commit it — it's already gitignored)
   - `SITE_URL` — leave as `http://localhost:3000` for local dev; **must**
     be updated to the real deployed domain before printing any label for
     real, since QR codes are generated from this value

Once that's done: `npm install && npm run dev`, then click through
mother → cutting → sold → outgoing log → CSV export → label print page in
a real browser, same as the Flask prototype was verified.

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

## Core data model (validated — do not change without good reason)

- **Mother_Plants** — source-of-truth record for each physical mother
  plant: Mother_ID, Display_Name, Location, and structured naming fields:
  Genus, Species, Qualifier (blank / "aff." / "cf." / "sp."),
  Collection_Code (used with Qualifier="sp."), Cultivar, Trade_Name,
  Hybrid (boolean). All present in `supabase/schema.sql`; only the naming
  *auto-composition* (see below) isn't wired into the UI yet.
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

1. Hoya structured naming entry UI + auto-composition (Genus/Species/
   Qualifier/Collection_Code/Cultivar/Trade_Name/Hybrid → Botanical
   Line1/Line2). Schema is ready; port the composer functions above.
2. Hoya_Species data import (563-row POWO list) + In_Collection
   auto-marking on mother creation/edit.
3. Data migration from the real Google Sheet (Mother_Plants,
   Hoya_Species, existing Cuttings, Outgoing_Log history).
4. Auth / multi-user, real hosting deploy, automated backups (roadmap doc
   calls this "Tier 2" — Supabase gives real auth and hosted Postgres for
   free when this is ready, unlike the Sheets-era single-password gate).
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
