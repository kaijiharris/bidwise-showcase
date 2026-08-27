"""
PropStream Equity Delta Tracker
================================
Compares PropStream enrichment data across runs to detect motivation signals.

When a property's equity position changes meaningfully between analysis runs,
it can indicate:
  - Rising equity (owner gaining more to lose — or more to pocket)
  - Falling equity (distress deepening — mortgage eating equity)
  - New liens appearing (escalating legal/financial pressure)
  - Foreclosure status change (immediate action window)

These delta signals are far more actionable than a single snapshot because
they show DIRECTION and VELOCITY of a seller's situation.

Usage:
    from execution.enrichment.equity_delta_tracker import EquityDeltaTracker

    tracker = EquityDeltaTracker()
    tracker.save_run(county="dekalb", results=enriched_results)
    delta_report = tracker.compare_latest_runs(county="dekalb")
"""

import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple
from loguru import logger


# ── Storage ───────────────────────────────────────────────────────────────────

DELTA_DIR = Path(".tmp/propstream_history")
DELTA_DIR.mkdir(parents=True, exist_ok=True)

# Equity change thresholds that matter
EQUITY_INCREASE_THRESHOLD = 10_000   # +$10K — meaningful gain
EQUITY_DECREASE_THRESHOLD = -10_000  # -$10K — meaningful loss / distress signal


class EquityDeltaTracker:
    """
    Stores PropStream enrichment snapshots and computes deltas between runs.

    Storage format: one JSON file per (county, run) in .tmp/propstream_history/
        dekalb_20260428_014500.json
        dekalb_20260501_093200.json
        ...

    Only properties with propstream_found=True are stored (no point tracking
    properties where we have no data to compare).
    """

    def __init__(self, storage_dir: Path = DELTA_DIR):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    # ── Write ─────────────────────────────────────────────────────────────────

    def save_run(self, county: str, results: List[Dict]) -> Path:
        """
        Persist the PropStream-enriched fields for all properties in a run.

        Args:
            county:  County key e.g. "dekalb"
            results: Full analysis results list (fields will be filtered down)

        Returns:
            Path to the saved snapshot file.
        """
        county = county.lower()
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        path = self.storage_dir / f"{county}_{timestamp}.json"

        # Only store PropStream fields + identity fields
        snapshots = []
        for r in results:
            if not r.get("propstream_found"):
                continue
            snapshots.append({
                # Identity
                "tax_id":      r.get("tax_id", ""),
                "address":     r.get("full_address", r.get("address", "")),
                "county":      county,
                "run_at":      datetime.now(timezone.utc).isoformat(),
                # PropStream snapshot
                "estimated_equity":   r.get("estimated_equity"),
                "mortgage_balance":   r.get("mortgage_balance"),
                "equity_tier":        r.get("equity_tier"),
                "is_absentee_owner":  r.get("is_absentee_owner"),
                "has_foreclosure":    r.get("has_foreclosure"),
                "foreclosure_status": r.get("foreclosure_status"),
                "has_open_liens":     r.get("has_open_liens"),
                "open_liens":         r.get("open_liens"),
                "owner_type":         r.get("owner_type"),
                "years_owned":        r.get("years_owned"),
                # Deal context (for ranking deltas)
                "roi_percent":   r.get("roi_percent"),
                "deal_score":    r.get("deal_score"),
                "arv":           r.get("arv"),
                "min_bid":       r.get("min_bid"),
            })

        path.write_text(json.dumps(snapshots, indent=2), encoding="utf-8")
        logger.info(f"Saved PropStream snapshot: {path} ({len(snapshots)} properties)")
        return path

    # ── Read ──────────────────────────────────────────────────────────────────

    def _load_runs(self, county: str) -> List[Tuple[str, List[Dict]]]:
        """
        Return all saved runs for a county, sorted oldest → newest.
        Returns list of (timestamp_str, snapshots) tuples.
        """
        county = county.lower()
        files  = sorted(self.storage_dir.glob(f"{county}_*.json"))
        runs   = []
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                runs.append((f.stem, data))
            except Exception as e:
                logger.warning(f"Could not load {f}: {e}")
        return runs

    def get_latest_two_runs(self, county: str) -> Tuple[Optional[List], Optional[List]]:
        """Return (previous_run, latest_run) snapshots. Either may be None."""
        runs = self._load_runs(county)
        if len(runs) == 0:
            return None, None
        if len(runs) == 1:
            return None, runs[-1][1]
        return runs[-2][1], runs[-1][1]

    # ── Compare ───────────────────────────────────────────────────────────────

    def compare_latest_runs(self, county: str) -> Dict:
        """
        Compute deltas between the two most recent PropStream snapshots.

        Returns a report dict with:
          - new_foreclosures:    properties that gained a foreclosure flag
          - new_liens:           properties where open_liens count increased
          - equity_rising:       equity increased by ≥ $10K (still motivated)
          - equity_falling:      equity fell by ≥ $10K (escalating distress)
          - tier_upgraded:       equity tier improved (e.g. LOW → MED)
          - tier_downgraded:     equity tier worsened (e.g. HIGH → MED)
          - summary_text:        human-readable summary
        """
        prev_run, latest_run = self.get_latest_two_runs(county)

        if latest_run is None:
            return {"error": f"No PropStream history found for county: {county}"}

        if prev_run is None:
            return {
                "info": "Only one run available — no delta possible yet.",
                "properties": len(latest_run),
                "county": county,
            }

        # Index previous run by address for fast lookup
        prev_by_addr = {r["address"]: r for r in prev_run}

        new_foreclosures: List[Dict] = []
        new_liens:        List[Dict] = []
        equity_rising:    List[Dict] = []
        equity_falling:   List[Dict] = []
        tier_upgraded:    List[Dict] = []
        tier_downgraded:  List[Dict] = []

        TIER_ORDER = {"UNDERWATER": 0, "LOW_EQUITY": 1, "MED_EQUITY": 2,
                      "HIGH_EQUITY": 3, "UNKNOWN": -1}

        for curr in latest_run:
            addr = curr["address"]
            prev = prev_by_addr.get(addr)
            if not prev:
                continue  # new property — no prior snapshot to compare

            # ── Foreclosure change ──────────────────────────────────────────
            if curr.get("has_foreclosure") and not prev.get("has_foreclosure"):
                new_foreclosures.append(_delta_record(prev, curr, "New foreclosure flag"))

            # ── Lien change ────────────────────────────────────────────────
            prev_liens = int(prev.get("open_liens") or 0)
            curr_liens = int(curr.get("open_liens") or 0)
            if curr_liens > prev_liens:
                new_liens.append(_delta_record(
                    prev, curr,
                    f"Liens: {prev_liens} → {curr_liens} (+{curr_liens - prev_liens})"
                ))

            # ── Equity change ───────────────────────────────────────────────
            prev_eq = prev.get("estimated_equity")
            curr_eq = curr.get("estimated_equity")
            if prev_eq is not None and curr_eq is not None:
                delta = curr_eq - prev_eq
                if delta >= EQUITY_INCREASE_THRESHOLD:
                    equity_rising.append(_delta_record(
                        prev, curr, f"Equity +${delta:,.0f}: ${prev_eq:,.0f} → ${curr_eq:,.0f}"
                    ))
                elif delta <= EQUITY_DECREASE_THRESHOLD:
                    equity_falling.append(_delta_record(
                        prev, curr, f"Equity ${delta:,.0f}: ${prev_eq:,.0f} → ${curr_eq:,.0f}"
                    ))

            # ── Equity tier change ──────────────────────────────────────────
            prev_tier = prev.get("equity_tier", "UNKNOWN")
            curr_tier = curr.get("equity_tier", "UNKNOWN")
            if prev_tier != curr_tier:
                prev_rank = TIER_ORDER.get(prev_tier, -1)
                curr_rank = TIER_ORDER.get(curr_tier, -1)
                record    = _delta_record(
                    prev, curr, f"Tier: {prev_tier} → {curr_tier}"
                )
                if curr_rank > prev_rank:
                    tier_upgraded.append(record)
                elif curr_rank < prev_rank:
                    tier_downgraded.append(record)

        # Sort each list by deal_score descending (best deals first)
        for lst in (new_foreclosures, new_liens, equity_rising,
                    equity_falling, tier_upgraded, tier_downgraded):
            lst.sort(key=lambda r: r.get("deal_score", 0), reverse=True)

        total_signals = sum(map(len, (
            new_foreclosures, new_liens, equity_falling, tier_downgraded
        )))

        summary_lines = [
            f"County: {county.title()} | Properties tracked: {len(latest_run)}",
            f"  [!] New foreclosures   : {len(new_foreclosures)}",
            f"  [!] New/increased liens: {len(new_liens)}",
            f"  [-] Equity falling     : {len(equity_falling)}",
            f"  [+] Equity rising      : {len(equity_rising)}",
            f"  [^] Tier upgraded      : {len(tier_upgraded)}",
            f"  [v] Tier downgraded    : {len(tier_downgraded)}",
            f"  [*] Priority signals   : {total_signals}",
        ]
        summary_text = "\n".join(summary_lines)
        logger.info(f"\nEquity Delta Report:\n{summary_text}")

        return {
            "county":           county,
            "properties":       len(latest_run),
            "new_foreclosures": new_foreclosures,
            "new_liens":        new_liens,
            "equity_rising":    equity_rising,
            "equity_falling":   equity_falling,
            "tier_upgraded":    tier_upgraded,
            "tier_downgraded":  tier_downgraded,
            "total_signals":    total_signals,
            "summary_text":     summary_text,
        }

    def export_delta_report(self, county: str, output_path: Optional[Path] = None) -> Path:
        """
        Write the delta report to a JSON file.
        Defaults to .tmp/propstream_history/{county}_delta_latest.json
        """
        report = self.compare_latest_runs(county)
        if output_path is None:
            output_path = self.storage_dir / f"{county.lower()}_delta_latest.json"
        output_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        logger.info(f"Delta report saved: {output_path}")
        return output_path


# ── Helpers ───────────────────────────────────────────────────────────────────

def _delta_record(prev: Dict, curr: Dict, signal: str) -> Dict:
    """Build a standardised delta record for reporting."""
    return {
        "address":          curr.get("address"),
        "tax_id":           curr.get("tax_id"),
        "signal":           signal,
        "deal_score":       curr.get("deal_score", 0),
        "roi_percent":      curr.get("roi_percent"),
        "arv":              curr.get("arv"),
        "min_bid":          curr.get("min_bid"),
        "equity_tier":      curr.get("equity_tier"),
        "foreclosure":      curr.get("foreclosure_status"),
        "is_absentee":      curr.get("is_absentee_owner"),
        "prev_equity":      prev.get("estimated_equity"),
        "curr_equity":      curr.get("estimated_equity"),
        "prev_liens":       prev.get("open_liens"),
        "curr_liens":       curr.get("open_liens"),
        "prev_foreclosure": prev.get("has_foreclosure"),
        "curr_foreclosure": curr.get("has_foreclosure"),
    }


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    tracker = EquityDeltaTracker()

    # Simulate two runs to verify delta logic
    run1 = [
        {
            "tax_id": "0628006039", "full_address": "3050 BERNAUER TRCE, Dunwoody, GA",
            "propstream_found": True, "estimated_equity": 80_000, "equity_tier": "MED_EQUITY",
            "has_foreclosure": False, "foreclosure_status": None, "open_liens": 0,
            "is_absentee_owner": True, "owner_type": "Absentee Owner", "years_owned": 8,
            "mortgage_balance": 120_000, "roi_percent": 42.0, "deal_score": 72.0,
            "arv": 220_000, "min_bid": 9_500,
        },
        {
            "tax_id": "0630701029", "full_address": "5249 ARRIE WAY, Dunwoody, GA",
            "propstream_found": True, "estimated_equity": 150_000, "equity_tier": "HIGH_EQUITY",
            "has_foreclosure": False, "foreclosure_status": None, "open_liens": 1,
            "is_absentee_owner": False, "owner_type": "Owner Occupied", "years_owned": 12,
            "mortgage_balance": 50_000, "roi_percent": 55.0, "deal_score": 82.0,
            "arv": 300_000, "min_bid": 7_200,
        },
    ]
    tracker.save_run("dekalb_test", run1)

    # Ensure second save gets a different timestamp
    import time as _time
    _time.sleep(0.01)

    run2 = [
        {
            **run1[0],
            "estimated_equity": 60_000,    # dropped $20K — distress signal
            "equity_tier": "MED_EQUITY",
            "has_foreclosure": True,        # NEW foreclosure
            "foreclosure_status": "Lis Pendens",
            "open_liens": 2,               # lien added
        },
        {
            **run1[1],
            "estimated_equity": 170_000,   # rose $20K
            "equity_tier": "HIGH_EQUITY",
        },
    ]
    tracker.save_run("dekalb_test", run2)

    report = tracker.compare_latest_runs("dekalb_test")
    print("\n" + report["summary_text"])
    print("\nNew Foreclosures:", json.dumps(report["new_foreclosures"], indent=2, default=str))
    print("Equity Falling:",   json.dumps(report["equity_falling"],   indent=2, default=str))
