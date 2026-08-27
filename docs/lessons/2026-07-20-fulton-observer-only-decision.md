# Fulton is observer-only — the deal engine requires a per-parcel bid, Fulton lists don't print one

**Date:** 2026-07-20
**Decision:** Fulton County stays **observer-only** (watchdog alerts + parcel
counts). Do **not** run its lists through the analysis pipeline or publish them
on the site until a per-parcel amount source exists.

## The finding

Fulton sheriff **levy** sale lists print only `sale# + parcel + address` — **no
dollar amount per parcel**. Every other GA county's list prints an opening /
cry-out / amount-due figure, and every publishable county's parser *drops* rows
without it:

- `parse_gwinnett.py:279` — `if tax_due is None or tax_due <= 0: continue`
- `parse_dekalb_improved.py:123` — same guard
- `parse_clayton.py` — finalize returns None (drops the row) when `tax_due is None`

So `tax_due > 0` on every analyzed parcel has always been a **system invariant**,
enforced at parse time. Nothing downstream re-checks it — because it never had to.

`parse_fulton.py` (Cycle 20) correctly emits `tax_due=None` for every parcel
(there is nothing to parse), breaking the invariant. The deal engine then fails
**silently**, not loudly:

- `ga_deal_calculator.py:382` — `tax_due = prop.get("tax_due", 0) or 0` -> `0`
- `:392` — `all_in_cost = tax_due + rehab + costs` -> missing the acquisition price
- `:398` — `roi = net_profit / all_in_cost` -> **systematically inflated**
- `:498` — `deal_score` derived from that ROI -> every parcel a fake "top deal"
- `min_bid = 0`, conservative-branch `max_bid = 0`
- redemption model `winning_bid = tax_due or 0` -> all scenarios zero

`nobid_guardrail.py` screens vacant/commercial/flood/small-lot only — **no
missing-bid screen**. The `DEGRADED — DO NOT PUBLISH` banner is comps/Apify-based
(`run_ga_county.py:1286`) and never fires on a missing amount. A Fulton run would
report **success** and publish fabricated numbers — a truth-gap credibility hit
for an honesty-positioned product.

## The decision and why

Three options were considered (roast Mode B, deterministic):
1. **Observer-only** — zero risk, Fulton already live + customer-dark. **Chosen.**
2. "No-bid-amount" analysis mode — real engine work (null+label ROI/min_bid,
   keep ARV + As-Is max-bid ceiling); deferred until demand justifies it.
3. Source the amounts (Fulton tax-commissioner delinquency lookup) — feasibility
   unverified; opening bid != printed taxes.

Observer-only keeps monthly Fulton value (alerts, parcel counts) with none of the
publish risk.

## What enforces it

- **Watchdog** already correct: `sources.ts` Fulton entry has no
  `subscriberEligible`, so it is operator-alerted but customer-dark
  (`SUBSCRIBER_ELIGIBLE_COUNTIES` excludes it).
- **Pipeline guard (new):** `execution/utils/publish_guard.py` +
  `run_ga_county.py` — a run whose parcels **all** lack `tax_due` now **exits 2
  before analysis** with a Fulton-specific message, instead of publishing
  garbage. This also back-stops a future parser regression on any county
  (if amounts ever stop extracting, the run refuses rather than ships).

## Generalizable lesson

An invariant enforced *only* at the edge (here: parsers dropping amount-less
rows) is invisible to everything downstream — so the first new source that
violates it fails silently, in the most dangerous way (plausible wrong numbers,
no error). When onboarding a new data source, check which **implicit invariants**
the existing sources all happen to satisfy, and add an explicit guard at the
consuming layer, not just the producing one.

See: `directives/fulton_onboarding_scope.md` (decision header),
memory `bidwise-launch-audit.md` (Cycle 21).
