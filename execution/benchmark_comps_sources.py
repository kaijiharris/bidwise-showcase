"""
Comps-source quality benchmark — compares the pipeline's comp sources.

Purpose: justify the Stage-4 fallback chain (Apify → RapidAPI → RentCast)
with data instead of assumptions. For each requested city it builds a comp
pool per source and scores what the deal engine would actually produce:

  apify    — OFFLINE baseline: reuses the comparables already published in
             web/data/{county}.json by the last pipeline run ($0 spend).
  rapidapi — live, only when RAPIDAPI_KEY is set (auto-skipped otherwise).
  rentcast — live, only when RENTCAST_API_KEY is set (1 call per city —
             free tier is 50 calls/month, keep city lists short).

Per (city, source) metrics: pool size, field completeness, median price,
median $/sqft, freshness, and the REAL engine ARV for a standardized
1,500 sqft 3/2 subject (calculate_arv_from_comps) + its pool quality.
Also reports same-address overlaps between the Apify (sold price) and
fallback (list price) pools — the direct proxy-error measurement.

Usage:
    python execution/benchmark_comps_sources.py --cities "Decatur,Suwanee"
    python execution/benchmark_comps_sources.py --cities Decatur --skip-rentcast

Output: console table + .tmp/comps_benchmark_<timestamp>.json
"""
import os
import re
import sys
import json
import argparse
import statistics
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

import dotenv

dotenv.load_dotenv(ROOT_DIR / ".env")

from execution.utils.ga_deal_calculator import calculate_arv_from_comps

# Standardized subject so ARVs are comparable across cities and sources.
SUBJECT_SQFT, SUBJECT_BEDS, SUBJECT_BATHS = 1500, 3, 2

DASHBOARD_JSONS = ("dekalb", "gwinnett", "clayton", "cobb")


# ── Pure helpers (unit-tested in tests/test_comps_benchmark.py) ───────────────

def _norm_addr_key(address: str) -> Optional[str]:
    """Normalize an address to 'STREETLINE|ZIP' for cross-source joining."""
    if not address or not isinstance(address, str):
        return None
    zip_m = re.search(r"\b(\d{5})(?:-\d{4})?\s*$", address)
    street = address.split(",")[0]
    street = re.sub(r"[^\w\s]", "", street).upper()
    street = re.sub(r"\s+", " ", street).strip()
    if not street:
        return None
    return f"{street}|{zip_m.group(1) if zip_m else ''}"


def _parse_sale_date(value) -> Optional[datetime]:
    """Parse a comp sale_date: epoch-ms int, epoch-s int, or ISO string."""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            ts = value / 1000 if value > 1e11 else value   # epoch ms vs s
            return datetime.fromtimestamp(ts)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError):
        return None


def pool_metrics(comps: List[Dict], now: Optional[datetime] = None) -> Dict:
    """Score one comp pool: size, completeness, medians, freshness, engine ARV."""
    now = now or datetime.now()
    n = len(comps)
    priced = [c for c in comps if c.get("sale_price")]
    with_sqft = [c for c in priced if c.get("sqft")]
    ages = [
        (now - d).days
        for c in comps
        if (d := _parse_sale_date(c.get("sale_date"))) is not None
    ]
    arv_data = calculate_arv_from_comps(
        comps, SUBJECT_SQFT, property_beds=SUBJECT_BEDS, property_baths=SUBJECT_BATHS
    )
    return {
        "n_comps": n,
        "pct_with_price": round(100 * len(priced) / n, 1) if n else 0.0,
        "pct_with_sqft": round(100 * len(with_sqft) / n, 1) if n else 0.0,
        "pct_with_beds": round(100 * sum(1 for c in comps if c.get("bedrooms")) / n, 1) if n else 0.0,
        "median_price": round(statistics.median(c["sale_price"] for c in priced), 0) if priced else None,
        "median_ppsf": round(
            statistics.median(c["sale_price"] / c["sqft"] for c in with_sqft), 2
        ) if with_sqft else None,
        "median_age_days": int(statistics.median(ages)) if ages else None,
        "engine_arv": arv_data["arv"],
        "engine_avg_comp_price": arv_data["comp_avg_price"],
        "engine_ppsf": arv_data["avg_price_sqft"],
        "engine_comps_used": arv_data.get("comps_used", 0),
        "engine_pool_quality": arv_data.get("comp_pool_quality", "NO_DATA"),
    }


def address_overlaps(pool_a: List[Dict], pool_b: List[Dict]) -> List[Dict]:
    """Same-address comps present in both pools → per-property price deltas.

    pool_a prices are treated as the reference (e.g. Apify sold prices);
    pool_b prices as the candidate proxy (e.g. RentCast last list price).
    """
    a_by_key = {k: c for c in pool_a if (k := _norm_addr_key(c.get("address")))}
    matches = []
    for comp_b in pool_b:
        key = _norm_addr_key(comp_b.get("address"))
        comp_a = a_by_key.get(key) if key else None
        if not comp_a:
            continue
        pa, pb = comp_a.get("sale_price"), comp_b.get("sale_price")
        if not (pa and pb):
            continue
        matches.append({
            "address": comp_a.get("address"),
            "ref_price": pa,
            "proxy_price": pb,
            "delta_pct": round(100 * (pb - pa) / pa, 2),
        })
    return matches


# ── Source pool builders ──────────────────────────────────────────────────────

def load_cached_apify_pools() -> Dict[str, List[Dict]]:
    """City → deduped Apify comp pool from all published dashboard JSONs."""
    pools: Dict[str, Dict[str, Dict]] = {}
    for county in DASHBOARD_JSONS:
        path = ROOT_DIR / "web" / "data" / f"{county}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        addr2city = {p.get("full_address"): p.get("city") for p in data.get("properties", [])}
        for comp in data.get("comparables", []):
            city = addr2city.get(comp.get("used_for_address"))
            addr = comp.get("address")
            if city and isinstance(addr, str):
                pools.setdefault(city, {})[addr] = comp   # dedup by address
    return {city: list(by_addr.values()) for city, by_addr in pools.items()}


def build_live_clients(skip_rapidapi: bool, skip_rentcast: bool) -> List[Tuple[str, object]]:
    """Instantiate live fallback clients for every armed key (order = chain order)."""
    clients: List[Tuple[str, object]] = []
    if not skip_rapidapi and os.getenv("RAPIDAPI_KEY"):
        from execution.enrichment.rapidapi_comps import RapidAPIComps
        clients.append(("rapidapi", RapidAPIComps()))
    if not skip_rentcast and os.getenv("RENTCAST_API_KEY"):
        from execution.enrichment.rentcast_comps import RentCastComps
        clients.append(("rentcast", RentCastComps()))
    return clients


# ── Report ────────────────────────────────────────────────────────────────────

def run_benchmark(cities: List[str], skip_rapidapi: bool, skip_rentcast: bool) -> Dict:
    apify_pools = load_cached_apify_pools()
    live_clients = build_live_clients(skip_rapidapi, skip_rentcast)
    skipped = [s for s in ("rapidapi", "rentcast") if s not in {n for n, _ in live_clients}]
    if skipped:
        print(f"NOTE: sources skipped (no key or --skip flag): {', '.join(skipped)}")

    report: Dict = {"run_at": datetime.now().isoformat(), "cities": {}, "sources_skipped": skipped}
    for city in cities:
        entry: Dict = {"sources": {}, "overlaps": {}}
        apify_pool = apify_pools.get(city, [])
        if apify_pool:
            entry["sources"]["apify"] = pool_metrics(apify_pool)
        else:
            print(f"WARNING: no cached Apify pool for {city} — baseline missing "
                  f"(known cities: {', '.join(sorted(apify_pools))})")

        for source_name, client in live_clients:
            pool = client.get_sold_properties(city=city, state_code="GA", limit=25)
            entry["sources"][source_name] = pool_metrics(pool)
            if apify_pool and pool:
                entry["overlaps"][source_name] = address_overlaps(apify_pool, pool)

        report["cities"][city] = entry
    return report


def print_report(report: Dict) -> None:
    cols = ("n_comps", "median_price", "median_ppsf", "engine_arv",
            "engine_pool_quality", "median_age_days", "pct_with_sqft")
    for city, entry in report["cities"].items():
        print(f"\n{'='*78}\n{city}\n{'-'*78}")
        print(f"{'source':10s} " + " ".join(f"{c:>19s}" if c == 'engine_pool_quality' else f"{c:>13s}" for c in cols))
        apify_arv = (entry["sources"].get("apify") or {}).get("engine_arv")
        for source, m in entry["sources"].items():
            row = f"{source:10s} "
            for c in cols:
                v = m.get(c)
                w = 19 if c == "engine_pool_quality" else 13
                row += f"{v if v is not None else '-':>{w}} "
            print(row)
            if source != "apify" and apify_arv and m.get("engine_arv"):
                delta = 100 * (m["engine_arv"] - apify_arv) / apify_arv
                # ASCII only: Windows cp1252 console chokes on arrows/set glyphs
                print(f"{'':10s} -> ARV delta vs apify baseline: {delta:+.1f}%")
        for source, matches in entry.get("overlaps", {}).items():
            if matches:
                deltas = [m["delta_pct"] for m in matches]
                print(f"  overlap apify+{source}: {len(matches)} same-address comps, "
                      f"median price delta {statistics.median(deltas):+.1f}% "
                      f"(proxy vs sold)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark comps sources per city")
    parser.add_argument("--cities", required=True,
                        help='Comma-separated city list, e.g. "Decatur,Stone Mountain"')
    parser.add_argument("--skip-rapidapi", action="store_true")
    parser.add_argument("--skip-rentcast", action="store_true",
                        help="Skip RentCast (saves free-tier quota: 1 call/city)")
    args = parser.parse_args()

    cities = [c.strip() for c in args.cities.split(",") if c.strip()]
    report = run_benchmark(cities, args.skip_rapidapi, args.skip_rentcast)

    # Save FIRST: the live calls cost quota — never lose them to a print error
    # (2026-07-04 lesson: cp1252 console crashed on a unicode arrow post-fetch).
    out_dir = ROOT_DIR / ".tmp"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"comps_benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"Saved: {out_path}")

    print_report(report)


if __name__ == "__main__":
    main()
