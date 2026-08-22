# Skrybix — Current Architecture

Reference doc, not a design document. It exists so anyone touching this
repo (human or Claude session) can get the load-bearing facts in one
place without reconstructing them from `CLAUDE.md`'s full history. If
something here goes stale, fix this file in the same PR that changes the
fact — don't let it drift.

## Where this lives

- **Production application:** https://skrybix-webapp.vercel.app
  (Vercel project `gathering-moss/skrybix-webapp`), password-protected via
  a real login page (`app/login/`), not Basic Auth.
- **Repository:** `HydraCoreSystems/skrybix-webapp`. **Default branch:
  `master`.**
- **Live Supabase project reference:** `zaqzlzofgmgvepbcjrut`. This is
  the actual production database — real inventory data, real customer
  QR-code redirects, real login. Treat it accordingly.

> **Shared-project warning:** this Supabase project (`zaqzlzofgmgvepbcjrut`)
> is presently **shared with Gathering Moss Financial Center**, not
> dedicated to Skrybix alone. Any schema change, RLS policy, or access
> grant made here has blast radius beyond this application — verify
> before broadening any grant (`anon`/`authenticated`/`public`) on this
> project, and coordinate before assuming exclusive ownership of it. See
> "Deployment and migration rules" below for how changes to this project
> are expected to be reviewed.

## What Skrybix is authoritative for

Skrybix is the source of truth for **botanical identity and physical
inventory**: mother plants, cuttings taken from them, their naming,
location, label-print history, and whether/why a cutting has left
physical inventory (sale, gift, loss, disposal, trade, personal use — see
`outgoing_log` and `skrybix_push_cuttings_to_outgoing()` in
`supabase/schema.sql`). It is not, and must not become, a competing sales
ledger — see the ownership boundary below.

## The ID/SKU contract

`mother_plants.mother_id` and `cuttings.cutting_id` are the **only**
identifiers in this system, and they **are** the GM Commerce/Shopify SKU,
byte-for-byte, including any embedded space (e.g. `HY-AH 01`,
`HY-AH 01-C08` are real, existing production IDs — the space is not a
typo and must never be trimmed or reformatted).

This was not always true: a short-lived standardized-SKU design
(`{GENUS}-{PLANT}-{MOTHER}[-C{CUTTING}]`, `commerce_skus` /
`genus_codes` / `plant_codes` in `supabase/schema.sql`) was built,
reviewed, and then **reversed by owner decision before it ever deployed**
(2026-08-15) after a real identifier-format audit showed it was itself
ambiguity-prone for real hybrid catalog numbers. Those objects remain in
the schema but are **dormant** — access to their functions is revoked
from every role including `service_role`, so the application's own real
access path cannot reach them. Do not resurrect that design without a
fresh owner decision. See `README.md`'s "GM Commerce handoff" section and
`CLAUDE.md`'s decision records (items 14–15) for the full history.

`mother_id`/`cutting_id` are also **permanent, opaque source
identities** — never renamed, never regex-normalized. Real mother QR
codes are printed with the literal current `mother_id` baked into the
image on physical labels already in circulation; changing one would 404
every already-printed QR code with no way to reissue history.

## Ownership boundaries: Skrybix vs. GM Commerce / Commercial Ledger

| Concern | Owner |
| --- | --- |
| Botanical identity, naming, species tracking | Skrybix |
| Physical inventory count (mothers, active cuttings) | Skrybix |
| Why a cutting left inventory (sale vs. gift/loss/disposal/trade/personal use) | Skrybix (`outgoing_log`) |
| Label printing, QR codes, print-queue/history | Skrybix |
| Listings, sales channels | GM Commerce / Commercial Ledger |
| Sale prices | GM Commerce / Commercial Ledger |
| Sales themselves (the commercial transaction) | GM Commerce / Commercial Ledger |
| Cross-listing closure (marking a listing sold/closed across channels) | GM Commerce / Commercial Ledger |

Skrybix hands off a **selection** (a human checking "Select for GM
Commerce" on a record, with required sale facts for a mother plant) via
the narrow authenticated API documented in `README.md`
(`GET /api/commerce/v1/plants`, `POST
/api/commerce/v1/plants/:recordId/acknowledge`), bearer-token protected
(`COMMERCE_EXPORT_KEY`). Skrybix does not track price, customer, payment,
or sales-channel state anywhere, and must not start doing so — that
would make it a second, competing sales ledger, which is explicitly not
its job. GM Commerce owns all downstream commerce state; the only write
access it has back into Skrybix is the single acknowledgement timestamp.

Skrybix's own `sold`/`selling_platform` fields on `cuttings` and
`outgoing_log` predate the GM Commerce handoff and remain in production
use (`sold` drives the "Push Sold → Outgoing Log" workflow). They are
**not removed** by this phase — removing them without a verified,
GM-Commerce-coordinated compatibility plan would risk breaking whatever
still reads them. Any future removal needs its own explicit plan, not a
silent drop.

## Deployment and migration rules

- **No migration is ever applied directly to production from a
  development/agent session.** A schema change is written and tested
  locally first (see below), reviewed as a PR, and applied to the live
  Supabase project (`zaqzlzofgmgvepbcjrut`) as its own deliberate,
  reviewed step — never bundled silently into an application deploy.
- **No deploy happens without review.** Vercel settings and the
  production deployment are not touched by an automated change; changes
  land as a PR against `master` and go through the owner's normal review.
- **Local verification before any migration is proposed:**
  `supabase/verify_commerce_sku_migration.sh` runs the full schema/
  migration suite (fresh-schema apply, upgrade-path apply from a frozen
  pre-migration fixture, schema parity between the two paths, safe
  re-apply, access-hardening checks, functional/negative-path SQL tests,
  and real concurrency scenarios) against a throwaway Postgres instance —
  set `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` to a disposable
  database and run it locally or in CI (`.github/workflows/
  commerce-sku-db.yml`) before ever proposing a migration against the
  real project.
- **CI:** `.github/workflows/ci.yml` runs `npm test` + `npm run build` on
  every push/PR, unconditionally. `.github/workflows/commerce-sku-db.yml`
  runs the schema/migration verification above, scoped to changes under
  `supabase/**`.
- Every multi-step database mutation in this schema is implemented as a
  single Postgres function body (one transaction), not orchestrated
  across multiple round trips from the application layer — see
  `next_cutting_seq()`, `select_cutting_for_commerce()`,
  `skrybix_mark_*_labels_printed()`, and `skrybix_push_cuttings_to_outgoing()`
  in `supabase/schema.sql` for the established pattern. Follow it for any
  new mutation that touches more than one table or more than one write.

## Known, deliberately deferred gaps (not day-one, tracked here so they aren't lost)

- RLS hardening exists for the commerce-SKU objects and the durable
  label-print RPCs, but **not** for the pre-existing tables
  (`mother_plants`, `cuttings`, `outgoing_log`, `hoya_species`,
  `site_auth`) — `supabase/schema.sql` itself flags this as "a real,
  separate, wider gap worth its own repo-wide hardening pass." The app
  never sends an `anon`/`authenticated` key to the browser (everything
  goes through the service-role client in `lib/supabase.ts`), which is
  why this hasn't been an active incident, but it is a real exposure on a
  Supabase project already shared with Financial Center.
- Next.js 14 → 16 migration to clear a set of CVE advisories that only
  close on the 16.x line (DoS, cache poisoning, SSRF in Server
  Actions/rewrites) — a breaking API-surface change (`params`/
  `searchParams` become async), deliberately not done unverified mid-build.
  Cross-project with `hydrocloud-webapp`, which carries the same exposure.
- Real individual multi-user accounts (Supabase Auth, per-person
  sign-on) — the current single shared site password is a deliberate
  pragmatic first step, not the intended end state.
- A durable failure/audit-event log for deeper reconciliation beyond
  what `commerce_selected_at`/`commerce_acknowledged_at` alone can show
  (see the dashboard's GM Commerce handoff health card and
  `lib/commerce-health.ts` — its "actionable failure" bucket is
  deliberately left unpopulated rather than fabricated, since no
  failure-tracking column exists yet).
