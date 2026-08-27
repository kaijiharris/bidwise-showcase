"""
Repair already-published dashboard datasets without re-running the pipeline
(no Apify/comps spend). Two deterministic passes over web/data/:

  1. Commercial reroute: records whose property_class matches the CURRENT
     _is_nonresidential_class() rules but which shipped through the residential
     flip model (e.g. the 47k-sqft "Nursing Home" on the Gwinnett 8/4 list) are
     recomputed with calculate_commercial_metrics(), their residential financial
     chain nulled, and a stipulation note added.

  2. Top-deal stamping: every record gets the client-facing `top_deal`
     verdict recomputed from the canonical gate (execution/utils/top_deals.py
     — ROI >= 100 + confidence requirements). Web/mobile filter on this flag
     because arv_source is server-only.

  3. Index count rebuild: every {county}_auctions.json entry gets its
     total/type/top_deals counts recomputed from the dataset file it references
     using auction_index.summarize_results() — the same canonical gate.

Usage:
    python execution/repair_published_datasets.py            # all counties
    python execution/repair_published_datasets.py gwinnett   # one county
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from execution.run_ga_county import _is_nonresidential_class, _append_note
from execution.utils.ga_deal_calculator import calculate_commercial_metrics
from execution.utils.auction_index import summarize_results
from execution.utils.top_deals import is_top_deal

DATA_DIR = Path("web/data")

# Residential-model fields that are meaningless once a record routes commercial.
_RESIDENTIAL_ONLY_KEYS = (
    "arv", "net_profit", "roi_percent", "net_proceeds", "selling_costs",
    "asis_sale_price", "asis_all_in_cost", "asis_net_profit", "asis_roi_percent",
)


def reroute_commercial(prop: dict) -> bool:
    """Re-route one record through the commercial model. Returns True if changed."""
    prop_class = (prop.get("property_class") or "").strip().upper()
    prop_type = prop.get("property_type") or ""
    if not _is_nonresidential_class(prop_class):
        return False
    if prop_type in ("Commercial", "Multi-Family"):
        return False  # already routed correctly

    metrics = calculate_commercial_metrics(prop)
    for key in _RESIDENTIAL_ONLY_KEYS:
        if key in prop:
            prop[key] = None
    prop.update({k: v for k, v in metrics.items() if k != "arv"})
    prop["arv"] = None
    prop["recommended_max_bid"] = metrics["max_bid"]
    prop["arv_source"] = "N/A"
    prop["property_type"] = "Commercial"
    prop["deal_score"] = 0.0
    _append_note(
        prop,
        f"RECLASSIFIED (repair {prop_class!r}): non-residential class routed to the "
        f"commercial/specialist model — residential comps and flip ROI do not apply. "
        f"County appraised value shown for reference only.",
    )
    return True


def stamp_top_deal(prop: dict) -> bool:
    """Recompute the client-facing top_deal verdict. Returns True if changed."""
    verdict = is_top_deal(prop)
    if prop.get("top_deal") == verdict:
        return False
    prop["top_deal"] = verdict
    return True


def repair_dataset_file(path: Path) -> int:
    with open(path) as f:
        data = json.load(f)
    props = data.get("properties", []) if isinstance(data, dict) else data
    changed = sum(1 for p in props if reroute_commercial(p))
    # Stamp AFTER reroutes so the verdict reflects the repaired record.
    changed += sum(1 for p in props if stamp_top_deal(p))
    if changed:
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
    return changed


def rebuild_index(county: str) -> list:
    idx_path = DATA_DIR / f"{county}_auctions.json"
    if not idx_path.exists():
        return []
    with open(idx_path) as f:
        index = json.load(f)

    updates = []
    for entry in index:
        data_file = DATA_DIR / Path(entry.get("file", "")).name
        if not data_file.exists():
            continue
        with open(data_file) as f:
            data = json.load(f)
        props = data.get("properties", []) if isinstance(data, dict) else data
        type_counts, top_deals = summarize_results(props)
        before = entry.get("top_deals")
        entry.update({
            "total_properties": len(props),
            "residential":      type_counts["residential"],
            "multi_family":     type_counts["multi_family"],
            "commercial":       type_counts["commercial"],
            "land":             type_counts["land"],
            "top_deals":        top_deals,
        })
        if before != top_deals:
            updates.append(f"{entry.get('auction_date')}: top_deals {before} -> {top_deals}")

    with open(idx_path, "w") as f:
        json.dump(index, f, indent=2)
    return updates


def main(counties: list) -> None:
    if not counties:
        counties = sorted({
            p.name.replace("_auctions.json", "")
            for p in DATA_DIR.glob("*_auctions.json")
        })

    for county in counties:
        rerouted = 0
        for path in [DATA_DIR / f"{county}.json", *DATA_DIR.glob(f"{county}_20??-??-??.json")]:
            if path.exists():
                n = repair_dataset_file(path)
                if n:
                    print(f"{path.name}: repaired {n} record(s) (commercial reroutes + top_deal stamps)")
                rerouted += n
        for change in rebuild_index(county):
            print(f"{county}_auctions.json: {change}")
        if not rerouted:
            print(f"{county}: no misclassified records")


if __name__ == "__main__":
    main(sys.argv[1:])
