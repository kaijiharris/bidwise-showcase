"""
Auction Index Manager
=====================
Maintains per-county auction index files at web/data/{county}_auctions.json.

Each index is an ordered list (newest first) of auction runs:
  [
    {
      "auction_date": "2026-05-05",
      "label":        "May 5, 2026",
      "file":         "/data/gwinnett_2026-05-05.json",
      "total_properties": 11,
      "residential":  6,
      "multi_family": 0,
      "commercial":   2,
      "land":         3,
      "top_deals":    4,      # is_top_deal() — execution/utils/top_deals.py
      "generated":    "2026-04-29T02:13:00"
    },
    ...
  ]

Usage (from a runner):
    from execution.utils.auction_index import register_auction, dated_output_path

    output_path = dated_output_path('gwinnett', auction_date)
    # ... save data to output_path ...
    register_auction('gwinnett', auction_date, results)
"""

import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict

from execution.utils.top_deals import is_top_deal, stamp_top_deals

# Server-only dataset dir. The web app reads these files from the server (they
# were moved out of web/public/ so PII JSON is no longer publicly downloadable).
# The `file` field below still uses the public-looking /data/... URL because the
# web app exposes a server route at that path — only the on-disk dir changed.
DATA_DIR = Path('web/data')


def dated_output_path(county: str, auction_date: str) -> Path:
    """
    Returns the canonical web/data path for a county+date combination.
    e.g. dated_output_path('gwinnett', '2026-05-05')
         -> Path('web/data/gwinnett_2026-05-05.json')
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / f"{county}_{auction_date}.json"


def _index_path(county: str) -> Path:
    return DATA_DIR / f"{county}_auctions.json"


def _load_index(county: str) -> List[Dict]:
    p = _index_path(county)
    if p.exists():
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _auction_label(auction_date: str) -> str:
    """Convert '2026-05-05' → 'May 5, 2026'."""
    try:
        dt = datetime.strptime(auction_date, '%Y-%m-%d')
        return dt.strftime('%B %-d, %Y') if hasattr(dt, 'strftime') else auction_date
    except Exception:
        pass
    # Windows doesn't support %-d; use manual strip
    try:
        dt = datetime.strptime(auction_date, '%Y-%m-%d')
        day = str(dt.day)
        return dt.strftime(f'%B {day}, %Y')
    except Exception:
        return auction_date


def summarize_results(results: List[Dict]) -> tuple:
    """
    Count property types and TOP DEALS for an auction index entry.

    A "top deal" is is_top_deal() — the canonical gate in
    execution/utils/top_deals.py, shared with the run_ga_county summary and
    mirrored by the web dashboard. It excludes land / estimate_only records
    (Codex review 2026-07-04, PR #16) and, since the 2026-07-17 truth-gap fix,
    also NO-BID guardrail screen-outs (is_no_bid) and thin-comp ESTIMATE_ONLY
    valuations — both used to inflate the dashboard's "{n} Top Deals" badge
    with parcels whose bid is nulled and deal_score is 0.
    """
    type_counts = {'residential': 0, 'multi_family': 0, 'commercial': 0, 'land': 0}
    top_deals = 0
    for r in results:
        pt = (r.get('property_type') or '').lower().replace('-', '_').replace(' ', '_')
        if 'multi' in pt or 'apartment' in pt:
            type_counts['multi_family'] += 1
        elif 'commercial' in pt or 'retail' in pt or 'industrial' in pt:
            type_counts['commercial'] += 1
        elif 'land' in pt or 'vacant' in pt:
            type_counts['land'] += 1
            continue  # land never counts toward top_deals
        else:
            type_counts['residential'] += 1
        if is_top_deal(r):
            top_deals += 1
    return type_counts, top_deals


def register_auction(county: str, auction_date: str, results: List[Dict]) -> Path:
    """
    Saves results to the dated JSON file and updates the county auction index.

    Args:
        county:       slug, e.g. 'gwinnett'
        auction_date: ISO date string, e.g. '2026-05-05'
        results:      list of analyzed property dicts

    Returns:
        Path to the saved data file
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = dated_output_path(county, auction_date)

    # Stamp the client-facing top_deal verdict before persisting — web/mobile
    # filter on this flag (arv_source is server-only, so clients cannot
    # re-derive the confidence gate themselves).
    results = stamp_top_deals(results)

    type_counts, top_deals = summarize_results(results)

    data_payload = {
        'auction_date':     auction_date,
        'county':           county,
        'properties':       results,
        'total_properties': len(results),
        'analysis_date':    datetime.now().isoformat(),
    }
    with open(output_path, 'w') as f:
        json.dump(data_payload, f, indent=2)

    # Update auction index
    index = _load_index(county)

    entry = {
        'auction_date':     auction_date,
        'label':            _auction_label(auction_date),
        'file':             f'/data/{county}_{auction_date}.json',
        'total_properties': len(results),
        'residential':      type_counts['residential'],
        'multi_family':     type_counts['multi_family'],
        'commercial':       type_counts['commercial'],
        'land':             type_counts['land'],
        'top_deals':        top_deals,
        'generated':        datetime.now().isoformat(),
    }

    # Replace existing entry for same date, or prepend
    index = [e for e in index if e.get('auction_date') != auction_date]
    index.insert(0, entry)
    # Sort newest first
    index.sort(key=lambda e: e.get('auction_date', ''), reverse=True)

    with open(_index_path(county), 'w') as f:
        json.dump(index, f, indent=2)

    return output_path


def update_index_to_main(county: str, results: List[Dict], auction_date: str = '') -> None:
    """
    Update the auction index so its top entry points to the main {county}.json file.
    Called after every pipeline run (with or without --date) so the dashboard always
    loads the freshest data instead of a stale dated snapshot.

    If auction_date is empty, tries to infer it from the first property in results.
    """
    inferred_date = auction_date or next(
        (r.get('auction_date') for r in results if r.get('auction_date')), ''
    )
    if not inferred_date:
        return  # no date to register — skip

    type_counts, top_deals = summarize_results(results)

    index = _load_index(county)
    entry = {
        'auction_date':     inferred_date,
        'label':            _auction_label(inferred_date),
        'file':             f'/data/{county}.json',   # always the main unified file
        'total_properties': len(results),
        'residential':      type_counts['residential'],
        'multi_family':     type_counts['multi_family'],
        'commercial':       type_counts['commercial'],
        'land':             type_counts['land'],
        'top_deals':        top_deals,
        'generated':        datetime.now().isoformat(),
    }

    # Replace existing entry for same date, or prepend
    index = [e for e in index if e.get('auction_date') != inferred_date]
    index.insert(0, entry)
    index.sort(key=lambda e: e.get('auction_date', ''), reverse=True)

    with open(_index_path(county), 'w') as f:
        json.dump(index, f, indent=2)


def get_latest_file(county: str) -> str | None:
    """Return the /data/... path of the most recent auction for a county."""
    index = _load_index(county)
    if index:
        return index[0].get('file')
    # Fallback: legacy file
    legacy = DATA_DIR / f"{county}.json"
    if legacy.exists():
        return f'/data/{county}.json'
    return None
