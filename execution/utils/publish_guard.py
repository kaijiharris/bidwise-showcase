"""
Publish Guard — refuse to analyze/publish an amount-less tax-sale source
========================================================================
A single, pure pre-analysis screen for run_ga_county.py.

Why this exists (Fulton observer-only decision, 2026-07-20 — see
directives/fulton_onboarding_scope.md and
docs/lessons/2026-07-20-fulton-observer-only-decision.md):

  Every PUBLISHABLE GA county's parser drops any row without an opening bid
  (parse_gwinnett.py:279, parse_dekalb_improved.py:123, parse_clayton finalize),
  so `tax_due` is guaranteed POSITIVE on every parcel that reaches the deal
  engine. The engine relies on that invariant: `ga_deal_calculator` coalesces a
  missing bid to 0 (`tax_due = prop.get("tax_due", 0) or 0`), which silently
    - drops the acquisition price out of all_in_cost,
    - inflates every ROI (real profit / too-small cost),
    - inflates every ROI-derived deal_score -> a leaderboard of fake "top deals",
    - zeroes min_bid and the conservative-branch max_bid,
  with NO existing guard to catch it (the DEGRADED banner is comps/Apify-based).

  Fulton's sheriff levy lists print NO per-parcel amount, so parse_fulton emits
  tax_due=None for every parcel, breaking the invariant. Rather than let the
  engine publish fabricated numbers, this guard makes an all-amount-less source
  a LOUD, refuse-to-publish stop.

Pure and dependency-free (no I/O, no pandas) so it is trivially unit-testable
and importable without the heavy runner dependencies.
"""

from typing import Iterable, Mapping


def positive_tax_due(value) -> bool:
    """True when `value` is a usable opening bid (parses to a number > 0).

    Mirrors the parser-level invariant every publishable county enforces
    (drop rows with tax_due <= 0). None, "", non-numeric, and <= 0 -> False.
    """
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def all_parcels_unpriced(properties: Iterable[Mapping]) -> bool:
    """True when a NON-EMPTY parcel list has NO parcel carrying a positive
    tax_due — i.e. the source published no amounts at all (the Fulton case).

    Deliberately scoped to the all-or-nothing condition: a normal county whose
    parser guarantees tax_due > 0 on every row can never trigger this, and a
    mixed source (some priced, some not) still runs. Only a source that is
    entirely amount-less is refused. An empty list returns False (there is
    nothing to refuse; upstream "no parcels" handling owns that case).
    """
    props = list(properties)
    if not props:
        return False
    return not any(positive_tax_due(p.get("tax_due")) for p in props)
