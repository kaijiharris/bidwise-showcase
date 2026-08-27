# Session lessons — Supabase data contract, publish flow, and release-window verification (2026-07-17/18)

One session's arc: close the pipeline→Supabase data-contract gap (PR #64), apply
the schema to prod, backfill a county (the 2026-09-01 DeKalb batch), publish it,
and verify the live dashboard end-to-end — surfacing six durable lessons and two
sibling fixes (PR #66 casing; PR #69/migration 025 paywall collapse, other
session) along the way.

## 1. Committed ≠ applied — always preflight prod schema

Migration `020_deal_engine_confidence_fields.sql` was merged to main but had
NEVER been applied to prod: preflight via the Management API showed none of its
columns existed. This repo applies migrations by hand and commits the files as
records; nothing tracks application state. **Before depending on any migration,
probe `information_schema` read-only.** Migration 022 was written to bundle
020 §1 idempotently and heal either state atomically.

## 2. `SELECT p.*` views freeze their column list at CREATE time

Postgres expands `*` when the view is created, not at query time. Migration 020
added table columns and referenced them as `v.<col>` in a dependent view WITHOUT
rebuilding the base view — an ordering that can never apply cleanly on a fresh
database ("column does not exist"). View evolution over a `p.*` base requires
DROP + CREATE of the whole chain in dependency order (CREATE OR REPLACE cannot
reorder or insert columns), re-asserting grants + security posture afterward.
(Superseded 2026-07-17 by migration 025's single self-contained definer view.)

## 3. `str.title()` on identifiers with interior capitals silently orphans data

`push_to_supabase.py` stored `county.title()` → `"Dekalb"`, while every consumer
(web `county=eq.DeKalb`, Flutter filter chips, refund RPC, the pipeline's own
`display_name`) filters `"DeKalb"` with exact case. Every pushed row was
invisible to every county-filtered query — no error anywhere. Fixed in PR #66
(`canonical_county()` display map + pinned tests) and prod normalized (206
property rows + 2 county_runs). **Lesson: display-name derivation must be a
single canonical map shared with consumers, never string transforms; and an
"INSERT works, SELECT finds nothing" symptom is often an identifier-normalization
mismatch, not missing data.**

## 4. The publish button didn't exist — the trigger is the mechanism

The push script's next-step log ("log in to the admin dashboard and click
Publish") described UI that was never built. The real mechanism is migration
002's trigger: `UPDATE properties SET review_status='approved' WHERE
batch_id='<uuid>'` auto-stamps `approved_at=now()`, `public_at=+24h`,
`published=TRUE`. Expert/admin see rows immediately; Starter/Pro after the 24 h
window, rank-capped (top-10/top-25) with financials masked beyond the cap.
Verified empirically after the window opened: 171/10/25/171 visible/unlocked by
tier, locked rows masked, unlocked rows full. **Operator docs must describe the
mechanism that exists, not the one that was planned** — now recorded in
`directives/county_analysis_procedure.md`.

## 5. A field can be "dead code" because of a data-contract gap (score_tier)

`score_tier` had a producer (Wave-2 scorer), a DB column (020), and a web
consumer (ConfidenceBadge) — but the producer was never wired into pipeline
output, so no data file ever carried it. One session removed the scorer as dead
code (PR #63) the same day another fixed the contract that would have surfaced
it. Neither was wrong: the field genuinely never flowed. **Before building
consumers or columns for a field, verify its producer actually emits it into the
artifact consumers read.** `score_tier` stays NULL by design; all consumers are
null-safe.

## 6. NULL means "never screened" — strict tri-state flag mapping

Guardrail flags (`is_no_bid`, `estimate_only`) map as None→NULL, 0/1→strict
boolean, blank strings→NULL. NULL renders as a normal deal (legacy rows must
never look screened-out), and PostgREST filters stay meaningful:
`or(estimate_only.is.null,estimate_only.eq.false)` keeps legacy rows visible
while excluding flagged land. The land-never-ranks contract is enforced in
depth: `deal_score=0` at the model, server-side feed exclusion on mobile,
suppression pills on web — prod data showed why (heuristic land ROI up to
15,645 % on score-0 parcels would otherwise top every ROI sort).

## 7. Subscriber-eye verification without credentials (recipe)

Self-minted HS256 JWTs from `SUPABASE_JWT_SECRET` are rejected by this project.
The working recipe: admin `generate_link` (type=magiclink — returns the link,
sends NO email) → `GET /auth/v1/verify?token=<hashed_token>` → capture
`#access_token` from the redirect → use as Bearer with the anon `apikey` against
PostgREST, or alone against `/api/data/*` (routes accept Bearer). Never clean up
via admin logout — it kills the real user's sessions; short-lived tokens expire
on their own. This proved the live site end-to-end per tier where SQL-level
simulation alone could not.

## Cross-references

- PRs: #64 (contract), #66 (casing), #69/migration 025 (paywall collapse,
  sibling session), #63 (scorer removal), #70 (Flutter hardening, sibling).
- Migrations: 020 (replay note), 022 (contract columns + view rebuild),
  025 (definer view supersedes the 022 chain).
- Tests: `tests/test_push_to_supabase.py` (contract + casing pins),
  `tests/test_migration_025_paywall.py` (posture pins).
- Directive: `directives/county_analysis_procedure.md` (Supabase data contract,
  canonical county names, publish mechanism).
