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
`gathering-moss/skrybix-webapp`), **password-protected** via a proper
login page — not the browser's native Basic Auth popup (that was the
2026-07-23 first pass, superseded same day once the owner asked for a
real login page + the ability to change the password without touching
Vercel config):

- `app/login/` — login page + `login`/`logout` server actions
- `app/settings/password/` — change-password page + action (requires
  being logged in already, verified by middleware)
- `lib/session.ts` — signed session cookie (HMAC-SHA256 via Web Crypto
  `crypto.subtle`, not Node's `crypto` module, so the exact same code
  works in both the Edge-runtime middleware and Node-runtime server
  actions)
- `lib/site-auth-db.ts` — reads/writes the bcrypt password hash in
  Supabase's `site_auth` table (singleton row, `id = 1`) — the password
  is **not** an env var anymore, it's real app data, which is what makes
  a self-service "change password" page possible
- `middleware.ts` — redirects unauthenticated requests to `/login`
  (server-enforced on every request, not just page navigation — see its
  comment for why that matters), fails closed if `AUTH_SECRET` isn't set

This is still a pragmatic first step, same framing as GM Money's own auth
decision — real individual Supabase Auth accounts (per-person sign-on,
not one shared password) are the eventual target for this app **and**
for `gm-money-webapp` and `hydrocloud-webapp` too, per the owner's
explicit 2026-07-23 direction. That doesn't mean build it now for those
other two repos without being asked — just don't be surprised when the
owner brings it up, and don't assume "one shared password" is a
permanent design decision for any of the three.

Env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`,
`AUTH_SECRET`) are set in Vercel's Production environment via
`vercel env add` — check with `vercel env ls`, don't assume `.env.local`
is the only place they live. The old `SITE_PASSWORD` env var (Basic Auth
era) has been removed from Vercel; don't resurrect it.

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

1. ~~Hoya structured naming entry UI + auto-composition~~ — **done
   2026-07-23**. `lib/hoya-naming.ts` composes Botanical_Line1/Line2 from
   the REAL columns (Genus/Species/Form_Code/Cultivar/Name_Type/
   Natural_Cultivar), not `Skrybix_FIXED_v2.gs`'s Qualifier/
   Collection_Code/Trade_Name/Hybrid (blank on every real row) — validated
   against all 147 real mother_plants rows (146/147 exact match on both
   lines) before wiring in. `components/MotherNamingFields.tsx` gives a
   live client-side preview on the mother add/edit forms, with a species
   `<datalist>` autocomplete against `hoya_species`. The edit page won't
   silently recompute over an existing manual override (see e.g.
   `HY-RHM10`'s hand-typed hybrid-cross note) — only starts in "auto" mode
   when the stored line is empty or already matches the composed value,
   with a "reset to auto-composed" link to switch back consciously.
2. ~~Hoya_Species In_Collection auto-marking~~ — **done 2026-07-23**,
   `lib/species-tracker.ts`, wired into `createMother`/`updateMother`.
   Marks a species owned the first time it's seen, never un-marks, never
   overwrites an existing Date_Added. Retroactively backfilled for the
   147 already-migrated mothers (43 species updated) since the tracker
   only fires going forward otherwise — re-run that backfill logic if a
   future bulk import ever adds mothers outside the normal create/edit
   flow (e.g. a second `scripts/import-sheets-data.mjs` run with new
   rows).
3. ~~Data migration from the real Google Sheet~~ — **done 2026-07-23**,
   see "Data migration" above. Re-run `scripts/import-sheets-data.mjs`
   with fresh CSV exports if the Sheet changes significantly before a full
   cutover, but this is no longer a blocker.
4. ~~Real hosting deploy~~ — **done 2026-07-23**, live at
   https://skrybix-webapp.vercel.app. ~~Password protection~~ — **done
   same day**, proper login page + change-password feature (see "Current
   state" above), superseding an earlier same-day Basic Auth pass. Still
   open: real individual multi-user accounts/roles (Supabase Auth,
   explicitly wanted eventually for this app and the other two sibling
   projects too) and automated backups (roadmap doc's "Tier 2").
5. ~~Label printer integration~~ — **direction settled 2026-07-25**. The
   Brother PT-P710BT (18mm continuous tape, USB) stays as the CSV →
   P-touch Editor mail-merge bridge for now — full automation via
   Brother's b-PAC SDK was already attempted in an earlier session and
   hit real, confirmed technical walls (COM parameter marshaling issues).
   Cloud code (Vercel) can never reach a USB printer directly regardless
   — that's a hard architectural limit, not a "not built yet" gap.
   **Confirmed permanent by the owner 2026-07-25** (previously just "the
   direction being tested off one successful print" — now explicitly the
   settled choice, not provisional): HP Smart Tank 7602r (standard network
   inkjet, no SDK needed) + Avery 8257 return address labels (0.75in ×
   2.25in, 30/sheet,
   3 cols × 10 rows). `app/labels/mothers` and `app/labels/cuttings` now
   render a print-accurate grid matching that exact sheet (see
   `app/globals.css`'s `--label-*`/`--sheet-*` custom properties) —
   "queue for print → open page → Ctrl+P," no CSV/mail-merge step needed
   at all. **Not yet physically verified** — margins/gaps are the
   OnlineLabels OL6950 product's confirmed-exact numbers for the
   identical label footprint (a real starting point, not a guess), but
   Avery 8257's own exact margins were never extracted with full
   confidence (see git log ~2026-07-25 for the research trail, including
   a caught-and-corrected error: an initial "2 cols × 15 rows" read of a
   low-detail template image was physically impossible and wrong — 3×10
   is correct, confirmed against the owner's actual downloaded Avery
   PDF). **Grid alignment confirmed correct via a real physical test
   print** — the `--sheet-*` margin/gap values (borrowed from the
   OnlineLabels OL6950 spec) worked on the owner's real Avery 8257 sheets
   with zero adjustment needed. The Phomemo M220 was evaluated and ruled
   out (20mm minimum width can't run the existing 18mm tape; no official
   SDK, only reverse-engineered community tools of uncertain maturity for
   this model specifically).

   **Real branding now wired in** (2026-07-25): `public/gm-logo.png`
   (real Gathering Moss logo, verified via direct RGBA pixel inspection
   to be a clean, correctly-transparent PNG — an earlier look at two
   other candidate files wrongly flagged them as corrupted, when the
   real problem was a local image-preview tool not compositing alpha
   transparency correctly, not the files themselves) appears on cutting
   labels only, matching the real physical Brother tape design exactly
   (`GM_Cutting_Label_18mm.lbx` has a logo + Instagram QR target,
   `GM_Mother_Label_18mm.lbx` has neither) — decoded directly from both
   real `.lbx` files (they're ZIP archives containing XML, same
   unzip-and-read approach as the `.docx` files elsewhere in this
   project). The cutting QR still points at `/plant/cutting/[id]` (the
   app's own tracking page), but that page now also shows a "Follow on
   Instagram" button, preserving the marketing reach the physical labels
   already had rather than silently dropping it in favor of pure
   tracking data. **Caught a real bug while verifying this**: `/plant/**`
   and `public/gm-logo.png` were never excluded from `middleware.ts`'s
   login requirement — any real customer scanning a physical QR code
   would have hit the site password screen instead of the intended
   public page. Fixed and verified with zero-cookie requests simulating
   a real scan, both locally and on production, before any real labels
   shipped with that URL on them.
6. Next.js 14→16 migration to clear the residual CVEs noted above
   (cross-project with `hydrocloud-webapp`).
7. ~~QR scan-count tracking~~ — **done 2026-07-25**. Simple running total
   per the owner's explicit request ("simple," not a detailed scan-event
   log). `mother_plants.scan_count` / `cuttings.scan_count`, incremented
   via atomic `increment_mother_scan_count()` / `increment_cutting_scan_count()`
   Postgres functions (plain `UPDATE ... SET scan_count = scan_count + 1`,
   not a read-then-write, so concurrent scans can't clobber each other).
   A page load on the public `/plant/**` pages is used as the stand-in for
   "someone scanned this" — those URLs aren't linked anywhere else or
   guessable, so a load is a reliable proxy for a real scan. Shown as a
   "Scans" column on the Mothers and Cuttings list pages. Verified against
   the live Supabase DB (not just the UI) before/after two real scans.
8. ~~Partial-sheet label printing~~ — **done 2026-07-25**. The owner
   confirmed the HP Smart Tank 7602r + Avery 8257 direction (item 5 above)
   is now permanent, and raised a real practical gap: he won't always have
   enough mothers/cuttings queued to fill an entire 30-label sheet, and
   needs to resume printing onto a partially-used physical sheet without
   double-printing over already-used labels. Solved with a starting-position
   picker (`components/LabelStartPicker.tsx`, `lib/labels.ts`) on both
   `app/labels/mothers` and `app/labels/cuttings` — a 3x10 grid matching
   the physical sheet layout, driven by a `?start=N` query param (no DB
   persistence; the owner explicitly said he'll set it manually every time
   rather than have the app try to remember the last stopping point). The
   print grid renders `start - 1` empty filler `.label-cell` divs before
   the real items so real content lands in the correct physical slot;
   warns (doesn't block) if the run would overflow onto a second sheet.
   Verified via direct DOM inspection (blank-cell count, picker
   used/will-print/empty class states, real link-click navigation) against
   the real queued print data, not just visual screenshots.

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
