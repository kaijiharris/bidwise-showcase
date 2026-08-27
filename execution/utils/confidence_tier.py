"""
Confidence-tier calibration — Wave 2 second net on the GA tax-deed deal engine.
================================================================================
A pure screening layer that runs AFTER the NO-BID guardrail (apply_guardrail) on
its SURVIVORS, grading each surviving bid by how defensible its valuation is and
rewriting deal_score / max_bid accordingly. It is the confidence complement to the
binary NO-BID guard: the guard decides "is this bid-able at all?", this decides
"how much do we trust the number?".

Why this exists (Wave 1 residual, 2026-07-07 Cobb run):
  The NO-BID guardrail stops the $185k landlocked-commercial case, but a THIN-COMP
  residential parcel (comp_count<=1 — the Sandtown/439-Waterman class) can still
  slip a five-figure bid through on a single fluke comp at a fabricated ROI (the
  corpus shows roi_percent up to 778% / 1414%). ESTIMATE_ONLY nulls that bid;
  LOW/MEDIUM cap its score; HIGH (well-comped) is preserved byte-for-byte so Wave
  1's competitive-bid calibration (#1) and redemption dual-ROI (#4) are untouched.

Standards the thresholds are anchored to (not invented):
  - IAAO COD (Coefficient of Dispersion): a residential COD <= 15 is the IAAO
    ratio-study standard for an acceptably uniform comp cluster; > 20 is poor.
  - Fannie/Freddie appraisal practice: a 3-comparable minimum is the conventional
    floor for a defensible valuation (below it -> LOW confidence).
  - FHFA / secondary-market convention: 5 recent closed comps is the "well-supported"
    median-of-comps bar (at/above it, with a tight COD, -> HIGH).
  - GA statutory assessment ratio: property is assessed at 40% of FMV, so an
    assessor-implied FMV = assessed_value / 0.40 is a legitimate sanity anchor.

The functions are pure (return NEW dicts/tuples/scalars; never mutate inputs) and
do no I/O, so they are deterministic and unit-testable without network/API keys.
"""

from statistics import median
from typing import Dict, List, Optional, Tuple

# ── Named thresholds (defensible constants; see module docstring for provenance) ─

GA_ASSESSMENT_RATIO = 0.40        # GA assesses at 40% of FMV -> FMV = assessed/0.40
COD_RESIDENTIAL_MAX = 15.0        # IAAO uniform-cluster ceiling for HIGH
COD_OTHER_MAX = 20.0              # poor-dispersion ceiling; above it -> LOW
COMP_FLOOR_MEDIUM = 3             # Fannie/Freddie 3-comp minimum for MEDIUM
COMP_TYPICAL_HIGH = 5            # FHFA 5-median "well-supported" bar for HIGH
ESTIMATE_ONLY_COMP_MAX = 1        # comp_count<=1 -> cannot value; ESTIMATE_ONLY

ROI_SANITY_CEILING = 200.0        # display/roi_percent clamp (Wave-1 A5)
LOW_TIER_ASSESSOR_BLEND = 0.5     # LOW-tier: blend bid half-way toward assessor FMV
MEDIUM_SCORE_CAP = 80.0           # MEDIUM tier deal_score ceiling
LOW_SCORE_CAP = 50.0              # LOW tier deal_score ceiling

# Pool-quality strings (from the ARV comp pool) that clear the HIGH gate.
_STRONG_POOLS = ("STRONG", "ADEQUATE")


# ── Field-alias readers (local copies — no cross-import that couples the guards) ─

def _first_present(prop: Dict, *keys: str):
    """Return the first non-None value among the given keys (alias resolution)."""
    for key in keys:
        val = prop.get(key)
        if val is not None:
            return val
    return None


def _to_float(raw) -> Optional[float]:
    """Best-effort float coercion; returns None on any non-numeric input."""
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


# ── Comp dispersion (IAAO COD) ─────────────────────────────────────────────────

def comp_dispersion_cod(ranked_comps: Optional[List[Dict]]) -> Optional[float]:
    """
    IAAO Coefficient of Dispersion over per-comp sale_price.

    Let M = median(sale_prices). COD = 100 * mean(|price_i - M|) / M.
    Returns None if fewer than 2 usable sale_price values (dispersion undefined),
    or if the median is 0 (avoid divide-by-zero). Pure — never mutates input.
    """
    if not ranked_comps:
        return None
    prices = [
        p for p in (_to_float(c.get("sale_price")) for c in ranked_comps)
        if p is not None and p > 0
    ]
    if len(prices) < 2:
        return None
    m = median(prices)
    if m == 0:
        return None
    mean_abs_dev = sum(abs(price - m) for price in prices) / len(prices)
    return round(100.0 * mean_abs_dev / m, 2)


# ── Assessor-implied FMV (GA 40% ratio sanity anchor) ──────────────────────────

def assessor_implied_fmv(prop: Dict) -> Optional[float]:
    """
    GA statutory 40% assessment ratio -> implied FMV = assessed / 0.40.
    Reads assessed_value or assessed. None when no assessed figure is present.
    Pure — never mutates input.
    """
    assessed = _to_float(_first_present(prop, "assessed_value", "assessed"))
    if assessed is None:
        return None
    return round(assessed / GA_ASSESSMENT_RATIO, 2)


# ── Confidence grading ─────────────────────────────────────────────────────────

def grade_confidence(
    comp_count: Optional[int],
    cod: Optional[float],
    pool_quality: Optional[str],
) -> str:
    """
    Grade a parcel's valuation confidence into HIGH / MEDIUM / LOW / ESTIMATE_ONLY.

    Order (load-bearing):
      - ESTIMATE_ONLY when comp_count is None or <= ESTIMATE_ONLY_COMP_MAX(1).
      - HIGH when comp_count>=5 AND cod is not None AND cod<=15 AND pool STRONG/ADEQUATE.
      - MEDIUM when comp_count>=3 AND (cod is None OR cod<=20).
      - else LOW (e.g. cod>20 with 3 comps, or comp_count==2).
    Pure scalar-in / string-out.
    """
    if comp_count is None or comp_count <= ESTIMATE_ONLY_COMP_MAX:
        return "ESTIMATE_ONLY"
    pool = (pool_quality or "").strip().upper()
    if (comp_count >= COMP_TYPICAL_HIGH and cod is not None
            and cod <= COD_RESIDENTIAL_MAX and pool in _STRONG_POOLS):
        return "HIGH"
    if comp_count >= COMP_FLOOR_MEDIUM and (cod is None or cod <= COD_OTHER_MAX):
        return "MEDIUM"
    return "LOW"


# ── Tier rewrite of deal_score / bid (pure helper, keeps apply body < 50 lines) ─

def _comp_count_from(prop: Dict, metrics: Dict) -> Optional[int]:
    """comp_count from metrics, else prop, else len(ranked_comps)."""
    raw = metrics.get("comp_count")
    if raw is None:
        raw = prop.get("comp_count")
    if raw is None:
        return len(prop.get("ranked_comps") or [])
    val = _to_float(raw)
    return int(val) if val is not None else None


def _blend_low_bid(max_bid: float, assessor_fmv: Optional[float]) -> float:
    """
    LOW-tier assessor blend, guarded so it can only LOWER a bid, never raise it.
    Blends the bid half-way toward min(bid, assessor_fmv) — using min() means the
    blend target never exceeds the original ceiling.
    """
    if not assessor_fmv:
        return max_bid
    target = min(max_bid, assessor_fmv)
    blended = max_bid * (1 - LOW_TIER_ASSESSOR_BLEND) + target * LOW_TIER_ASSESSOR_BLEND
    return round(blended, 2)


def _rewrite_score_and_bid(out: Dict, prop: Dict, tier: str) -> None:
    """
    Apply the tier score/bid rewrite IN PLACE on the already-copied `out` dict.
    (out is a fresh copy owned by apply_confidence_tier — inputs stay untouched.)

    estimate_only (land model) -> keep the model's score/bid verbatim.
    HIGH   -> deal_score = base − score_penalty.
    MEDIUM -> deal_score = min(base, 80) − score_penalty.
    LOW    -> deal_score = min(base, 50) − score_penalty + assessor blend
              (blend only lowers the bid).
    ESTIMATE_ONLY -> score 0, max_bid/recommended_max_bid None, value_range set.
    score_penalty is the guardrail's recorded risk deduction (improved-parcel
    floodplain −15), re-applied AFTER the cap so it stays visible; floor 0.
    """
    from execution.utils.ga_deal_calculator import raw_opportunity_score

    # Land-model contract (county_analysis_procedure.md / PR #16): the land
    # model hard-sets deal_score=0.0 with estimate_only=True — land never ranks
    # until an acreage-aware model lands, and its roi_percent is a rough
    # heuristic, not a scoreable signal. Re-deriving from that ROI resurrected
    # 0-scores as 50/80/72.6 on the Clayton 2026-08-04 land parcels. Keep the
    # model's score/bid verbatim (tier fields are annotated by the caller).
    if out.get("estimate_only"):
        return

    if tier == "ESTIMATE_ONLY":
        out["deal_score"] = 0.0
        out["max_bid"] = None
        out["recommended_max_bid"] = None
        out["value_range"] = "ESTIMATE_ONLY — insufficient comps to bid"
        return

    base = raw_opportunity_score(out.get("roi_percent"))
    # Guardrail risk deductions arrive on score_penalty because this rewrite
    # rebuilds the score from ROI (the in-place −15 the guardrail applied to
    # deal_score would otherwise be silently discarded — 2026-07-16 audit).
    # Applied after the tier cap so capped MEDIUM/LOW scores stay penalized.
    penalty = _to_float(out.get("score_penalty")) or 0.0
    if tier == "HIGH":
        out["deal_score"] = max(0.0, round(base - penalty, 1))
        return
    if tier == "MEDIUM":
        out["deal_score"] = max(0.0, round(min(base, MEDIUM_SCORE_CAP) - penalty, 1))
        return
    # LOW
    out["deal_score"] = max(0.0, round(min(base, LOW_SCORE_CAP) - penalty, 1))
    if out.get("max_bid"):
        out["max_bid"] = _blend_low_bid(out["max_bid"], assessor_implied_fmv(prop))
        out["recommended_max_bid"] = out["max_bid"]


# ── Comp-age demotion (2026-07-12 recycling policy) ────────────────────────────

# Comp store age tier that triggers a one-notch demotion. Appraisal practice
# (Fannie B4-1.3-08) accepts comps up to 6 months old as standard, so an AGED
# pool (91–180 days) stays fully usable — it just can't claim the freshest
# "well-supported" badge: HIGH demotes to MEDIUM; MEDIUM/LOW stand as graded.
POOL_AGE_TIER_AGED = "aged"


def demote_for_pool_age(tier: str, pool_age_tier: Optional[str]) -> str:
    """One-notch HIGH→MEDIUM demotion when the comp pool is in the AGED band."""
    if pool_age_tier == POOL_AGE_TIER_AGED and tier == "HIGH":
        return "MEDIUM"
    return tier


# ── Public entry point ─────────────────────────────────────────────────────────

def apply_confidence_tier(prop: Dict, metrics: Dict, pool_age_tier: Optional[str] = None) -> Dict:
    """
    Return a NEW metrics dict with the confidence tier applied. Runs on guardrail
    SURVIVORS only — a NO-BID is a verbatim no-op (never resurrected).

    Sets arv_confidence, comp_cod, assessor_implied_fmv; clamps roi_percent<=200;
    rewrites deal_score by tier (HIGH keep / MEDIUM cap 80 / LOW cap 50 + assessor
    blend / ESTIMATE_ONLY -> score 0 + bids None), then re-applies the guardrail's
    score_penalty (improved-parcel floodplain −15) after the cap. pool_age_tier
    (from the comp store: fresh/aged) demotes HIGH→MEDIUM when the pool is
    91–180 days old.
    estimate_only metrics (the land model's never-ranks contract) keep their
    model-set deal_score/bids verbatim — only the annotation fields are added.
    Never touches roi_if_deed_matures, asis_roi_percent, or the redemption.*
    fields. Never mutates prop or metrics.
    """
    if metrics.get("is_no_bid"):
        return dict(metrics)  # verbatim no-op — never resurrect a NO-BID

    out = dict(metrics)
    cc = _comp_count_from(prop, metrics)
    cod = comp_dispersion_cod(prop.get("ranked_comps"))
    pool = metrics.get("comp_pool_quality") or prop.get("comp_pool_quality")
    tier = demote_for_pool_age(grade_confidence(cc, cod, pool), pool_age_tier)

    out["arv_confidence"] = tier
    out["comp_cod"] = cod
    out["assessor_implied_fmv"] = assessor_implied_fmv(prop)

    if out.get("roi_percent") is not None:
        out["roi_percent"] = min(out["roi_percent"], ROI_SANITY_CEILING)

    _rewrite_score_and_bid(out, prop, tier)
    return out
