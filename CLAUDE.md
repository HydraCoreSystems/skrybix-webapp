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

**2026-08-13 incident: login looked broken but wasn't.** The owner
couldn't log in and was certain the password was right. Root cause
turned out to be the free-tier Supabase project itself auto-pausing
after ~7 days of no API traffic (Skrybix isn't used daily the way
`gm-money-webapp` is) — the DB was unreachable, and the login action's
generic failure path made that look identical to "wrong password."
Recovered via **Resume project** in the Supabase dashboard; no data
loss (auto-pause preserves everything). Fixed for good with a
**Vercel Cron keepalive** (`app/api/cron/keepalive/route.ts`, wired in
`vercel.json`, once daily) that does a real tiny Supabase query so the
project never sits quiet long enough to pause again — chosen over
upgrading to Supabase Pro since the owner didn't want the added cost.
Optional `CRON_SECRET` env var (see `.env.example`) locks the route
down to Vercel's own cron invocations; safe to leave unset, it just
means the route doesn't verify the caller. If login ever looks broken
again despite a correct password, check the Supabase project's pause
state *before* assuming the password hash is wrong.

**2026-08-13: real Mother_ID auto-assignment + Location dropdown added.**
Two real regressions from the web app rebuild, both now fixed:

- **Mother ID was a plain manually-typed text field on `/mothers/new`**,
  with zero auto-generation — despite `mother_plants.spec3`/`mother_seq`
  existing in the schema specifically for this and the owner being
  explicit this was *never* something he chose by hand on the original
  Sheet. The `reference/Skrybix_FIXED_v2.gs` script's own auto-ID logic
  (`syncMotherRow_`, gated on a Hoya_Species match) only covers
  identified species and doesn't explain the many real unidentified/
  cultivar rows (`HY-AH 01`, `HY-CRY01`, `HY-DRA01`, etc.) — the real
  rule turned out to live as data convention on the live sheet itself,
  not as script code, and was recovered by reading the actual production
  `Mother_Plants` data from Drive (not guessed): **Mother_ID = `HY-` +
  the first 3 characters (uppercased, NOT trimmed) of the species name
  if one is recorded, otherwise of the cultivar/descriptor text + a
  zero-padded 2-digit sequence number for that code.** The trailing
  space in IDs like `HY-AH 01` and `HY-CV 01` is real (the 3rd character
  of "AH Black Magic" / "CV Marvel" is a space) — do not "fix" it away.
  Implemented in `lib/mother-id.ts` (`deriveSpec3`/`buildMotherId`) +
  `mother_id_counters` / `next_mother_seq()` in `supabase/schema.sql`
  (atomic UPSERT counter, same pattern as `next_cutting_seq()` — never
  regenerate by scanning `mother_plants` for a max value). **Before this
  ships, the counter must be seeded from real production data** so it
  can't collide with an existing Mother_ID — run this once in the
  Supabase SQL editor after applying the updated `schema.sql`:
  ```sql
  insert into mother_id_counters (spec3, next_seq)
  select spec3, max(mother_seq::int) + 1
  from mother_plants
  where spec3 is not null and mother_seq ~ '^[0-9]+$'
  group by spec3
  on conflict (spec3) do update
    set next_seq = greatest(mother_id_counters.next_seq, excluded.next_seq);
  ```
  `/mothers/new` no longer has a Mother_ID input at all — it's assigned
  server-side in `createMother()` after Species/Cultivar are known, and
  shown read-only on the edit page as before (unchanged there, it was
  already correctly `disabled`).
- **Location was free text**; the owner wants a fixed dropdown instead.
  Replaced with `components/LocationSelect.tsx` sourcing options from
  `lib/locations.ts` (owner's 2026-08-13 list: Grow Room, Upstairs,
  Upstairs Closet, Upstairs Grow Tent, Downstairs, Milsbo, Fabrikor) —
  supersedes the old GR/UP/FA/MI/LR/UP-CLOSET abbreviations. Historical
  rows keep whatever value they already have; the select adds the
  current stored value as an extra option when it isn't one of the
  standard seven, so editing a legacy row never silently overwrites its
  location.

This matters more than a typical cosmetic fix: Mother_ID is the string
every downstream Cutting_ID (and therefore the GM Commerce SKU, see the
commerce handoff above) is built from — getting the derivation wrong or
seeding the counter wrong risks duplicate/colliding SKUs in a live
sales channel, not just a display glitch.

**Same day, same root cause: Display Name was also a manually-typed
required field**, also never something the owner filled in on the
original sheet. Confirmed against the same real live sheet data pulled
from Drive: `Display_Name` is just `Botanical_Line1 + " " +
Botanical_Line2`, with straight quotes instead of the curly quotes used
on Line2 for printed labels (`composeDisplayName()` in
`lib/hoya-naming.ts`). `createMother`/`updateMother` now derive it from
whatever Line1/Line2 actually end up being (including a manual override
of either, so a deliberate hybrid-cross note carries through instead of
the two silently diverging) — no separate input on `/mothers/new`
anymore, shown read-only on the edit page like Mother ID.

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
9. ~~"Queued ✓" not reflecting on the labels page~~ — **fixed 2026-07-25**.
   Real bug, found from the owner's own report: `toggleCuttingField` and
   `toggleMotherPrint` only called `revalidatePath` on the list page
   (`/cuttings` / `/mothers`), never on the corresponding labels page
   (`/labels/cuttings` / `/labels/mothers`). `revalidatePath` is also what
   invalidates Next.js's *client-side* router cache for a path, not just
   server data — so a browser that had visited a labels page earlier in
   the session kept serving a stale cached snapshot after queuing new
   items, even though `dynamic = "force-dynamic"` guarantees a fresh
   *server* render. `clearMotherPrintQueue`/`clearCuttingPrintQueue`
   already revalidated both paths correctly — the toggle actions were the
   only ones missing it. Real-world consequence: the owner queued 10
   cuttings, the labels page showed a stale "0 queued" from an earlier
   visit, and clicking "Clear print queue" from that confusing state
   really did wipe the (actually-queued) rows back to `print_label =
   false`, regardless of what the stale UI displayed — confirmed directly
   against the production DB, not guessed. Fix: both toggle actions now
   also revalidate their labels-page counterpart. Verified by reproducing
   the exact stale-cache sequence locally (visit labels page → toggle a
   real cutting from the list → client-side nav back to the labels page)
   and confirming the fresh item appears immediately post-fix. Also added
   explicit `fetchCache = 'force-no-store'` + `revalidate = 0` on all four
   pages in this flow, on top of the existing `force-dynamic`, as a
   belt-and-suspenders hardening pass after the owner reported the same
   symptom recurring once more post-fix (that second recurrence traced to
   a browser tab left open from before the deploy, running old client-side
   JS — re-verified the actual fix was solid via a fresh tab both times).
10. ~~Cutting label QR going to the Skrybix app instead of Instagram~~ —
    **fixed 2026-07-25**. The owner strongly objected (his words: "Skrybix
    is for gathering moss only") after his own phone, still logged in from
    testing, showed the full internal admin nav (Cuttings, Outgoing Log,
    Settings, Log out) when he scanned a real printed cutting label — a
    real customer must never see any of that. `app/plant/cutting/
    [cuttingId]/page.tsx` no longer renders an info page at all: it
    validates the cutting exists, increments `scan_count`, then issues a
    true server-side `redirect()` straight to the Instagram profile —
    matching what the original physical Brother labels did before Skrybix
    existed. This preserves the scan-count tracking feature (item 7 above)
    while guaranteeing zero Skrybix branding is ever visible to a customer,
    since the redirect happens before any HTML renders (verified via `curl
    -D -` showing a bare 307 with no body, and confirmed `scan_count` still
    increments and a bogus cutting ID still 404s instead of redirecting
    blindly). Mother plant labels are unaffected and intentionally
    unchanged — `/plant/[motherId]` stays a real internal tracking page,
    since mother plants aren't shipped to customers, only cuttings are.
    Also bumped label text/logo/QR sizing (font 6pt→7pt, logo/QR
    ~0.45-0.55in→0.52-0.6in) per the owner's readability feedback on a real
    printed sheet — verified against the actual longest real label text in
    the database (not a guess) via DOM `scrollHeight`/`clientHeight`
    comparison, confirming zero clipping on both mothers and cuttings.

    **Correction, same day, still item 10**: the redirect fix above was
    NOT enough on its own. The owner scanned a real already-printed label
    with his phone and the camera's own QR-preview chip showed the raw
    `*.vercel.app` URL *before* he even tapped it — because that's the
    literal text baked into the printed QR image, and a server-side
    redirect only changes what happens *after* the link is opened, not
    what the QR encodes. Real fix: `lib/qr.ts` now exports
    `CUTTING_INSTAGRAM_URL`, and newly generated cutting QR codes (in
    `app/labels/cuttings/page.tsx` and the CSV export route) encode that
    Instagram URL *directly* — no Skrybix domain involved at any point,
    matching the original Brother labels exactly. This does mean
    scan-count tracking (item 7) no longer fires for cuttings printed
    from here on, since we never see the request once the QR points
    straight at Instagram — a real, disclosed tradeoff, not an oversight.
    `/plant/cutting/[cuttingId]` survives only as a safety net for
    already-printed labels still carrying the old Skrybix-URL QR.
    Verified by importing the real `lib/qr.ts` module in a throwaway
    script, generating the actual QR PNG, and decoding it with a real QR
    decoder (`jsqr`) to confirm the pixel content is exactly
    `https://www.instagram.com/gathering_moss_ftw` — not inferred, not
    assumed. **Caught a real mistake making this fix**: a blanket
    `UPDATE cuttings SET print_label = false WHERE print_label = true`
    run to clean up local test data also wiped 6 real cuttings the owner
    had queued in production concurrently (`HY-AH 01-C03` through `C08`)
    — disclosed to the owner immediately; he needs to re-queue those.

Ask the owner before starting on any of these — scope order hasn't been
confirmed yet.

11. **2026-08-13: fixed a real multi-sheet print-alignment bug, found
    from the owner asking "what happens if I'm at label 24 and queue 12
    more?"** Before this, `/labels/mothers` and `/labels/cuttings`
    rendered the whole queue as one continuous `.label-sheet` CSS grid.
    The `--sheet-margin-top`/`--sheet-margin-left` offset (the blank
    space before position 1, confirmed against a real physical test
    print) was applied only once, at the very start of that grid — so a
    run overflowing past position 30 would start its second physical
    page flush against the page edge, misaligned with a fresh blank
    Avery sheet's real label positions. The UI already warned about
    overflow but didn't actually print the second sheet correctly.
    Fixed with `chunkIntoSheets()` (`lib/labels.ts`) + `LabelSheets`
    (`components/LabelSheets.tsx`): the queue is now split into one
    chunk per physical sheet — only the first chunk gets leading blank
    cells (from the start-position picker), every sheet after that
    starts fresh at position 1 with zero blanks — and each chunk renders
    as its own `.label-sheet` div, so the margin offset reapplies per
    sheet and `break-before: page` (`.label-sheet + .label-sheet` in
    `globals.css`) forces a real page boundary between them. Verified
    the chunking logic directly (`chunkIntoSheets(12 items, start=24)` →
    sheet 1 gets 23 blanks + positions 24-30, sheet 2 gets 0 blanks +
    the remaining 5) before wiring it in.

    Same pass also fixed a real regression from the 2026-08-13 review
    UI enlargement (previous entry): the `zoom: 1.45` used to make the
    on-screen label preview legible was wide enough to overflow past the
    card's right edge on a browser window narrower than ~1260px — the
    owner caught this from a real screenshot. Reduced to `zoom: 1.25`
    and added `max-width: 100%; overflow-x: auto` on `.label-sheet` as a
    belt-and-suspenders fix so any narrower window scrolls horizontally
    within its own bordered area instead of visually spilling past the
    card. Print output is unaffected either way — `zoom` is explicitly
    reset to 1 inside `@media print`.

12. **2026-08-13: Light/Dark/System theme support**, ported directly
    from `gm-money-web`'s proven pattern rather than reinventing it —
    same synchronous inline bootstrap script in `layout.tsx` (that
    project found `next/script`'s `beforeInteractive` unreliable on
    specific routes) plus a defensive `ThemeSync` re-check on mount,
    both keyed on `localStorage`'s `skrybix-theme`. New Appearance card
    (`components/ThemePicker.tsx`) on Settings. Every hardcoded color in
    `globals.css` converted to theme-aware `--token`s, with a dark
    palette via both the `prefers-color-scheme` media query (System) and
    explicit `[data-theme]` selectors (an intentional choice always wins
    over the OS either direction). Caught and fixed a real bug before
    shipping: `.btn.secondary`'s text referenced `--green-dark`, a
    near-black green in the dark palette — invisible against the dark
    card background. Changed to `--green`, tuned for contrast against
    `--card` in both themes.

    **Default is `dark`, not `system`** — the owner is the sole user of
    this app and explicitly prefers dark over light once he saw both
    (2026-08-13: "I love the dark theme setup much better than the light
    theme"), so there's no reason to make him pick it every time
    `localStorage` is empty (a fresh browser/device, or cleared site
    data). An explicit System/Light choice saved in Settings still always
    wins once one exists. If gm-money-web or hydrocloud-webapp ever get
    a "pick the app default" conversation, don't assume this same
    default applies there without asking — this was Skrybix-specific,
    from Skrybix's actual single-owner usage pattern.

13. **2026-08-13: mother plants can now be listed for sale through GM
    Commerce, not just cuttings.** The owner asked directly ("What would
    happen if I wanted to list a mother plant for sale? I don't see a
    way to do that at present") — confirmed real: the entire handoff
    was hardcoded to cuttings only (`plantRecordType: "cutting"` was a
    fixed literal, `mother_plants` had no `commerce_selected_at`/
    `commerce_acknowledged_at`/`sold` columns, no selection checkbox on
    the Mothers list). Owner explicitly chose "mirror the cutting flow"
    over a narrower option when asked.

    Generalized `lib/commerce-export.ts` rather than duplicating it:
    `CommercePlantRecord.plantRecordType` is now `"cutting" | "mother"`,
    `parentSourceRecordId` is nullable (`null` for a mother — it has no
    parent in Skrybix's hierarchy), added `MotherCommerceSource` +
    `normalizeMotherForCommerce()` mirroring the cutting versions, and
    `createCommerceExport()` now takes both cuttings and mothers arrays
    and merges them into one export. `mother_plants` gained
    `sold`/`commerce_selected_at`/`commerce_acknowledged_at` columns
    (same pattern as `cuttings`) — **no `archived_at`**, since mother
    plants have no archive concept in this schema, only real deletion;
    `MotherCommerceSource.archived_at` is always `null`, never read from
    the DB (there's no column to read).

    `GET /api/commerce/v1/plants` now queries both tables and merges.
    `POST /api/commerce/v1/plants/:recordId/acknowledge` (renamed from
    `:cuttingId` — same URL shape, `cuttingId` was just the wrong name
    now) tries the `cuttings` table first, then `mother_plants`, since a
    Cutting_ID and Mother_ID have no shared registry and the only
    reliable way to know which table an id belongs to is to actually
    look, not pattern-match the string.

    `components/CommerceSelectionControl.tsx` takes `recordId`/`kind`
    instead of `cuttingId` now, used identically from both the Cuttings
    and Mothers list pages. `toggleMotherPrint` was replaced with a
    generic `toggleMotherField(motherId, field, value)` (mirrors
    `toggleCuttingField`) so the new `sold` toggle didn't need a second
    near-duplicate function.

    **This is a cross-system contract change** — `README.md`'s GM
    Commerce handoff section was updated to match (mixed record types in
    one list, nullable `parentSourceRecordId`/`archivedAt`, renamed
    acknowledge param). If/when GM Commerce's own side gets touched,
    make sure whoever's working on it has read the updated README, not
    just the code — the shape of what it now receives changed.

    **Deliberately NOT built**: pushing a sold mother plant to
    `outgoing_log` the way `pushSoldToOutgoingLog()` does for cuttings.
    The owner only asked about GM Commerce listing capability; selling a
    whole mother plant is a different inventory event than selling a
    cutting (the mother leaving the collection entirely vs. a routine
    cutting sale), and folding it into the same disposal-log workflow
    wasn't asked for. Revisit if/when the owner actually sells a mother
    plant and wants that logged somewhere.

14. **2026-08-13 DECISION RECORD — plant source identity and commercial
    SKU are separate, immutable concepts.** Full design rationale in
    `docs/Skrybix_Commerce_SKU_Design_Report.md`; this is the durable
    summary. Owner-approved architecture, implemented and verified
    against a real local Postgres instance, **not yet deployed** — see
    "deployment" below.

    - `Mother_ID`/`Cutting_ID` (the existing `mother_plants.mother_id`/
      `cuttings.cutting_id` primary keys) are **permanent, opaque source
      identities** — never renamed, never regex-normalized, never
      touched by anything in this feature. Real IDs may contain a space
      (`HY-AH 05` etc.) and must stay exactly as-is. This is
      non-negotiable specifically because mother QR codes are printed
      with the literal current `mother_id` baked into the image on
      physical labels already in circulation (`lib/qr.ts`) — changing
      one would 404 every already-printed QR code with no way to
      reissue history.
    - A **separate, additive, immutable commercial SKU** is assigned
      per record: `{GENUS}-{PLANT}-{MOTHER}` for a mother,
      `{GENUS}-{PLANT}-{MOTHER}-C{CUTTING}` for a cutting. `GENUS` is 2
      uppercase letters, `PLANT` is 3 uppercase letters/digits, both
      from controlled registries (`genus_codes`/`plant_codes`,
      `supabase/schema.sql`) — never derived by slicing a name. Approved
      initial codes: `HY` = Hoya, `AL` = Alocasia. **Do not add further
      genus codes speculatively** — add one deliberately, in
      `genus_codes`, only when a plant of that genus is actually about
      to be sold.
    - SKUs are assigned **atomically at first GM Commerce selection**,
      not at record creation — `select_mother_for_commerce()`/
      `select_cutting_for_commerce()` (`supabase/schema.sql`), each one
      Postgres function body (one transaction). Selecting a cutting
      whose mother has no SKU yet **reserves** the mother's SKU first —
      this never selects, exports, or acknowledges the mother as a side
      effect; that stays a separate, explicit human action. Verified
      live under real concurrency (two cuttings selected simultaneously
      from the same never-before-selected mother → exactly one mother
      SKU, two distinct cutting sequences, mother still unselected
      afterward) and for rollback atomicity (a failed mother-facts
      validation rolls back the SKU assignment that happened earlier in
      the same call, leaving zero rows behind).
    - Immutability is **database-enforced**, not just "no application
      code updates it": a trigger rejects any `UPDATE` on `commerce_skus`
      outright, and real foreign keys from `commerce_skus` to
      `genus_codes`/`plant_codes` mean a registry code already used in
      an assigned SKU can't be renamed or deleted — Postgres refuses
      automatically, no extra trigger needed for that part. All of this
      was verified against a real local Postgres 16 instance (not
      reasoned about on paper) — see `supabase/commerce_sku_tests.sql`
      for the reproducible script and the implementation report for full
      output.
    - `sourceRecordId` (GM Commerce API) is still the permanent Skrybix
      ID, used for acknowledgement and idempotent import, exactly as
      before. `sku` is now looked up from `commerce_skus`, never equal
      to `sourceRecordId` by construction. `normalizeCuttingForCommerce`/
      `normalizeMotherForCommerce` (`lib/commerce-export.ts`) **fail
      closed** — throw rather than export a selected record with no
      resolvable SKU — instead of ever falling back to `sourceRecordId`
      as a placeholder SKU.
    - **Required mother-sale facts**, collected at first mother
      selection, never inferred from `plantRecordType="mother"` and
      never read from the general `notes` field: sale-photo subject
      (exact plant vs. representative), pot size, approximate
      plant/vine size, rooted/established confirmation, shipping
      presentation (ships in pot vs. prepared another way, with a
      required detail when the latter). Optional but exportable:
      condition/recent-cutback notes. `mother_commerce_facts`
      (`supabase/schema.sql`) enforces the required ones as real
      `NOT NULL`/`CHECK` columns, not just client-side validation.
      Quantity is locked to `1` at the database level (a selected
      mother record is always exactly one whole plant) — revisit only
      if Phil later approves a different model. Cutting selection does
      **not** collect these facts — cutting content stays as it was.
    - **Deployment**: implemented and verified, **deliberately not
      deployed yet** — do not merge/push this until GM Commerce is
      ready to stop assuming `sourceRecordId === sku` and persist
      whatever `sku` it receives verbatim. Coordinate the cutover so
      there's no mixed/ambiguous period where some selected records
      have the old (source-ID-as-SKU) behavior and some have the new
      one. Before flipping this on in production, also run the legacy
      rollout query (in the implementation report) to find any
      currently-selected-but-unacknowledged records from before this
      shipped and assign them real SKUs deliberately — do not assume
      any specific record is "the only one" without actually querying.

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
