"""
Canonical "Top Deals" predicate
===============================
Single source of truth for which analyzed parcels may be RANKED as deals and
which earn the public "Top Deal" label.

History: three surfaces defined "Top Deal" independently and drifted apart
(truth-gap audit 2026-07-17, PR #62 unified the trust gate). The remaining
ROI-threshold split (pipeline 30 vs dashboard 100) was RESOLVED by operator
decision on 2026-07-17: the public bar is ROI >= 100. Distribution analysis
over the four live datasets showed ROI >= 30 selected 90% of rankable parcels
(a non-selective hype label — Cobb 100%, Gwinnett 99%) while ROI >= 100
selected 48% with identical comp depth and source quality. roi_percent is
computed at the OPENING bid (tax_due all-in), so a parcel must model ~100%+
at the floor to net the 30-60% realistic return after competitive bid-up.

is_rankable() — economics trustworthy enough to DISPLAY/rank at all:
  - roi_percent present
  - not the land model's estimate_only heuristic (PR #16 contract)
  - not a NO-BID guardrail screen-out (is_no_bid)
  - not the thin-comp "ESTIMATE_ONLY" arv_confidence tier
  - not Vacant Land

is_top_deal() — rankable AND roi >= TOP_DEAL_MIN_ROI AND is_confident_valuation():
  - ARV is comp-evidenced: arv_source is not the assessor fallback (no comps)
    or the assessor arv-guard (comps ARV failed the sanity guard — the
    evidence CONFLICTED; conflicted parcels stay visible but never "Top")
  - comps_used_for_arv (fallback comp_count) >= TOP_DEAL_MIN_COMPS — beyond
    both thin-comp proxies (<=1 is the ESTIMATE_ONLY tier, <=2 the legacy
    weak-comp proxy)
  - arv_confidence != "LOW" (Wave-2 wide-dispersion tier; HIGH/MEDIUM or the
    field's absence on pre-Wave data pass)
  - roi_percent <= ROI_SANITY_CEILING — over-200 values only exist on records
    that predate the Wave-1 A5 clamp and "are artifacts, not returns"

Clients RENDER the pipeline's verdict instead of re-deriving it: the data API
strips arv_source for every tier (INTERNAL_SOURCE_FIELDS), so the web/mobile
mirrors cannot evaluate this gate themselves. stamp_top_deals() writes a
`top_deal` boolean onto every exported record; web/lib/topDeals.ts and the
mobile feed trust the flag and fall back to a best-effort client gate only on
unstamped archive data. KEEP THE MIRRORS IN SYNC.
"""

from typing import Dict, List, Optional

from execution.utils.ga_deal_calculator import ROI_SANITY_CEILING

# Public Top-Deal bar (percent ROI at the opening-bid all-in). Operator
# decision 2026-07-17 — unified across pipeline summary, auction-index badge,
# web dashboard, and mobile feed.
TOP_DEAL_MIN_ROI = 100.0
# Over-clamp ROIs are pre-Wave-1 artifacts, never returns.
TOP_DEAL_MAX_ROI = ROI_SANITY_CEILING
# Minimum comps behind the ARV for the "confident" label.
TOP_DEAL_MIN_COMPS = 3
# Lower bound of the "possible deal" band in the run summary.
POSSIBLE_DEAL_MIN_ROI = 20.0


def is_rankable(record: Dict) -> bool:
    """True when a parcel's economics are trustworthy enough to rank at all."""
    return (
        record.get("roi_percent") is not None
        and not record.get("estimate_only")
        and not record.get("is_no_bid")
        and record.get("arv_confidence") != "ESTIMATE_ONLY"
        and record.get("property_type") != "Vacant Land"
    )


def _comps_used(record: Dict) -> Optional[int]:
    used = record.get("comps_used_for_arv")
    return record.get("comp_count") if used is None else used


def is_confident_valuation(record: Dict) -> bool:
    """Evidence gate for the PUBLIC Top-Deal label (null-safe on every field)."""
    arv_source = record.get("arv_source") or ""
    return (
        not arv_source.startswith("assessor")
        and (_comps_used(record) or 0) >= TOP_DEAL_MIN_COMPS
        and record.get("arv_confidence") != "LOW"
        and (record.get("roi_percent") or 0) <= TOP_DEAL_MAX_ROI
    )


def is_top_deal(record: Dict, roi_threshold: float = TOP_DEAL_MIN_ROI) -> bool:
    """Canonical Top-Deal test: rankable, roi >= threshold, and confident."""
    return (
        is_rankable(record)
        and record["roi_percent"] >= roi_threshold
        and is_confident_valuation(record)
    )


def stamp_top_deals(results: List[Dict]) -> List[Dict]:
    """Return NEW records carrying the client-facing `top_deal` verdict.

    Pure — inputs are untouched. Every dataset writer (run_ga_county export,
    register_auction, repair_published_datasets) stamps before persisting so
    web/mobile can filter on the flag without re-deriving server-only fields.
    """
    return [{**r, "top_deal": is_top_deal(r)} for r in results]
