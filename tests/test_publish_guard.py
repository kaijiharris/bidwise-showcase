"""Tests for the amount-less-source publish guard (Fulton observer-only).

Pure — no I/O, no runner import. Guards the invariant that run_ga_county
refuses to analyze a source with no per-parcel opening bid.
"""
from execution.utils.publish_guard import all_parcels_unpriced, positive_tax_due


def test_positive_tax_due_accepts_real_bids():
    assert positive_tax_due(10727.16) is True
    assert positive_tax_due("10727.16") is True
    assert positive_tax_due(1) is True


def test_positive_tax_due_rejects_missing_or_nonpositive():
    for bad in (None, "", "n/a", 0, 0.0, -5, [], {}):
        assert positive_tax_due(bad) is False


def test_all_unpriced_true_for_fulton_shaped_input():
    # parse_fulton emits tax_due=None for every parcel (list prints no amounts).
    fulton = [
        {"parcel_id": "11-0161-0079-075-0", "address": "465 NORTH PINE DR", "tax_due": None},
        {"parcel_id": "14-0179-0003-090-4", "address": "132 FAIRFIELD PL NW", "tax_due": None},
    ]
    assert all_parcels_unpriced(fulton) is True


def test_all_unpriced_false_for_normal_county():
    # Clayton/Gwinnett/DeKalb: parser guarantees tax_due > 0 on every row.
    priced = [
        {"parcel_id": "05176A D012", "tax_due": 10727.16},
        {"parcel_id": "R7215 286", "tax_due": 4200.0},
    ]
    assert all_parcels_unpriced(priced) is False


def test_all_unpriced_false_when_any_parcel_priced():
    # A mixed source still runs — the guard only fires on an ENTIRELY
    # amount-less list, so one real bid keeps the run alive.
    mixed = [
        {"parcel_id": "A", "tax_due": None},
        {"parcel_id": "B", "tax_due": 3500.0},
        {"parcel_id": "C", "tax_due": None},
    ]
    assert all_parcels_unpriced(mixed) is False


def test_empty_list_is_not_refused_here():
    # Nothing to refuse; upstream "no parsed file / 0 parcels" handling owns it.
    assert all_parcels_unpriced([]) is False


def test_zero_and_negative_bids_count_as_unpriced():
    # tax_due present but <= 0 is not a usable bid (mirrors the parser drop).
    assert all_parcels_unpriced([{"tax_due": 0}, {"tax_due": -1}]) is True
