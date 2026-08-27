import json
import os
import glob
from flask import request, jsonify, g
from api.v1 import v1_blueprint
from api.v1.auth import require_auth, DISCLAIMER


def _load_properties():
    """Load latest enriched properties from .tmp/dekalb_results/."""
    results_dir = os.path.join('.tmp', 'dekalb_results')
    files = sorted(glob.glob(os.path.join(results_dir, 'dekalb_enriched_*.json')))
    if not files:
        return []
    with open(files[-1], 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('properties', [])


def _safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _serialize_summary(p):
    """Lightweight dict for list views."""
    return {
        'parcel_id':     p.get('tax_id') or p.get('parcel_id', ''),
        'address':       p.get('full_address') or p.get('assessor_address', ''),
        'city':          p.get('city', ''),
        'zip':           p.get('zip', ''),
        'county':        p.get('county', 'DeKalb'),
        'property_type': p.get('property_type', ''),
        'deal_score':    _safe_float(p.get('deal_score') or p.get('score')) or 0.0,
        'tax_due':       _safe_float(p.get('tax_due')),
    }


def _serialize_detail(p):
    """Full dict for detail views."""
    base = _serialize_summary(p)
    base.update({
        'beds':                  p.get('beds'),
        'baths':                 p.get('baths'),
        'sqft':                  p.get('sqft'),
        'year_built':            p.get('year_built'),
        'rehab_category':        p.get('rehab_category', ''),
        'crime_score':           _safe_float(p.get('crime_score')),
        'flood_zone':            p.get('flood_zone', ''),
        'composite_risk_score':  _safe_float(p.get('composite_risk_score')),
        'comp_count':            p.get('comp_count'),
        'disclaimer':            DISCLAIMER,
    })
    return base


# MARK: - Routes

@v1_blueprint.route('/status', methods=['GET'])
def v1_status():
    props = _load_properties()
    return jsonify({
        'online':    True,
        'version':   'v1',
        'prop_count': len(props),
    })


@v1_blueprint.route('/properties', methods=['GET'])
@require_auth
def list_properties():
    props = _load_properties()

    # Filters
    county    = request.args.get('county', '').lower()
    prop_type = request.args.get('property_type', '').lower()
    min_score = request.args.get('min_score', type=float)
    sort_by   = request.args.get('sort', 'deal_score')

    if county:
        props = [p for p in props if p.get('county', '').lower() == county]
    if prop_type:
        props = [p for p in props if p.get('property_type', '').lower() == prop_type]
    if min_score is not None:
        props = [p for p in props
                 if (_safe_float(p.get('deal_score') or p.get('score')) or 0) >= min_score]

    # Sort
    reverse = True
    if sort_by == 'roi':
        props = sorted(props, key=lambda p: _safe_float(p.get('roi')) or 0, reverse=reverse)
    elif sort_by == 'profit':
        props = sorted(props, key=lambda p: _safe_float(p.get('profit')) or 0, reverse=reverse)
    else:
        props = sorted(props,
                       key=lambda p: _safe_float(p.get('deal_score') or p.get('score')) or 0,
                       reverse=reverse)

    # Pagination
    page     = max(1, request.args.get('page', 1, type=int))
    per_page = min(100, max(1, request.args.get('per_page', 50, type=int)))
    total    = len(props)
    pages    = max(1, (total + per_page - 1) // per_page)
    start    = (page - 1) * per_page
    paged    = props[start:start + per_page]

    return jsonify({
        'properties': [_serialize_summary(p) for p in paged],
        'page':       page,
        'per_page':   per_page,
        'total':      total,
        'pages':      pages,
        'disclaimer': DISCLAIMER,
    })


@v1_blueprint.route('/properties/<parcel_id>', methods=['GET'])
@require_auth
def get_property(parcel_id):
    props = _load_properties()
    for p in props:
        pid = p.get('tax_id') or p.get('parcel_id', '')
        if pid == parcel_id:
            return jsonify(_serialize_detail(p))
    return jsonify({'error': 'Property not found'}), 404
