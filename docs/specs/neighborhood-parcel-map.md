# Spec: Neighborhood Parcel Map (Zillow-style lot lines + value chips)

**Status:** PROPOSED — awaiting founder sign-off before build
**Author:** pipeline session 2026-07-04 (from user's Zillow screenshots)
**Companion features shipped separately:** what-if net-proceeds calculator, comparative value scale (both live in the detail panel as of 2026-07-04).

## Goal

In the property detail panel, show a small map of the subject parcel and its
immediate neighbors with lot lines and a value chip per parcel — like Zillow's
"Neighborhood" lot-lines view. Answers "what does this pocket look like?"
without leaving the dashboard.

## Feasibility — verified facts

- **Clayton** publishes parcel polygons + values on its own ArcGIS Enterprise
  (11.5): `TaxAssessor/Parcels/MapServer/0`, `maxRecordCount=2000`, fields
  `PARCELID, APPRVAL, SITEADDRES, ACERAGE…` (live-verified 2026-07-02/04).
  Layer supports `query` with envelope geometry; `outSR=4326` + `f=geojson`
  need one-time verification per county (ArcGIS ≥10.4 supports both; Clayton
  is 11.5).
- **Gwinnett** parcels live on an ArcGIS Online FeatureServer
  (`Property_and_Tax`), **DeKalb/Cobb** on county MapServers — same query
  pattern, different field names. Roll out county-by-county behind a flag;
  the enricher modules already document each county's endpoints.
- Subject centroid: query the subject by `PARCELID` first and use its extent
  (the layers carry `_inside_x/_inside_y`, but those are in the layer's native
  spatial reference — request `outSR=4326` and use the returned geometry
  instead of trusting raw centroid fields).

## Architecture

```
Panel (client)                    Next.js server                County GIS
──────────────                    ───────────────               ──────────
"View neighborhood map"  ──────▶  GET /api/parcels
  (collapsed by default)            ?county=clayton&id=<taxId>
                                    ├─ auth: Supabase session      (same
                                    │  + row-unlock check           gate as
                                    │  (tier masking parity)        /api/data)
                                    ├─ cache hit? ──────────────▶  else 1-2 queries:
                                    │   (24h, bbox-grid key)        subject by PARCELID,
                                    │                               neighbors by envelope
                                    └─ GeoJSON FeatureCollection ◀─ outFields=id,value,addr
Leaflet (dynamic import) ◀────────  {parcels, subjectId}
```

**Server proxy is mandatory**, for three reasons:
1. **Tier integrity** — a locked row's masked address must not be
   reverse-engineerable; the route requires the same unlock the dataset API
   enforces before returning geometry centered on the subject.
2. **County-server etiquette** — we cache and clamp so N dashboard users never
   translate into N county-GIS hits (see limits below).
3. **County abstraction** — per-county endpoint/field mapping lives server-side
   next to the existing registry patterns.

## Renderer decision

**Leaflet via `next/dynamic` (SSR off)** — parcels are a few dozen simple
GeoJSON polygons + `divIcon` value chips; no vector tiles needed.

| Option | gz size | Verdict |
|---|---|---|
| Leaflet + react-leaflet | ~55 KB, lazy-loaded on expand | ✅ fits the 300 KB app-page budget |
| MapLibre GL | ~220 KB + worker | ❌ overkill for polygons |
| Static SVG (no lib) | 0 KB | fallback if we drop basemap entirely |

**v1 ships with NO third-party basemap** — white/neutral background with lot
lines and chips (closest to Zillow's "Lot lines" toggle, zero tile-license
questions, zero external requests from the client). Satellite/OSM basemap is a
v2 decision (OSM tile policy discourages production app usage; if we want
imagery we should price CARTO/MapTiler or use Esri World Imagery with
attribution).

## Query contract (server → county GIS)

```
GET {layer}/query
  where=PARCELID='<subject>'                     → subject polygon + extent
GET {layer}/query
  geometry=<xmin,ymin,xmax,ymax>&geometryType=esriGeometryEnvelope
  &inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects
  &outFields=PARCELID,APPRVAL,SITEADDRES
  &resultRecordCount=250&returnGeometry=true&f=geojson
```

Envelope = subject extent buffered ~150 m, clamped to ≤ 500 m square.

## Limits, ToU, and etiquette

- County ArcGIS services are public and keyless, but not contractual: **cache
  aggressively** (server-side, keyed by county + bbox snapped to a 100 m grid,
  TTL 24 h — parcel values change ~annually), **clamp** (≤250 parcels, ≤2
  upstream queries per cache miss), and **attribute** ("Parcel data © {County}
  County GIS" in the map footer).
- Per-user rate limit on `/api/parcels` (mirror the export route's limiter,
  e.g. 30/min) so a scripted client can't bulk-harvest county data through us —
  this is also a PII posture issue, same reason the datasets moved server-only.
- Feature-flag per county (`parcelMap: true` in the web county registry) —
  enable only after verifying `f=geojson`/`outSR=4326` on that county's layer.

## Value chips

- Default chip: county appraised value (`APPRVAL`) — matches what Zillow shows
  and is what the GIS returns.
- The subject parcel's chip shows **our model value** (ARV or land value) in
  the brand color, visually distinct from neighbor appraisals.
- Open question for founder: also badge auction parcels that appear in the
  neighbor set (cross-reference against the loaded dataset)? Cheap and high
  value for spotting adjacent-lot plays like the Hannah Assets 4-lot run.

## Build phases (estimate: ~1.5 dev-days total)

1. **Clayton spike** (½ day): `/api/parcels` route + Leaflet panel section
   behind `parcelMap` flag, admin-only.
2. **Hardening** (½ day): unlock/tier checks, rate limit, cache, error/empty
   states, dark mode, attribution.
3. **Rollout** (½ day): verify + enable Gwinnett/DeKalb/Cobb layers, screenshot
   QA both themes, bundle check (`next build` size diff).

## Risks

- County layer schema drift (field renames) → per-county field map + graceful
  "map unavailable" state; never block the panel.
- Spatial-reference surprises (State Plane vs WGS84) → always request
  `outSR=4326`; validate ring winding before rendering.
- Very large rural parcels (Shamrock Rd is 5–20 acres) → clamp zoom-to-extent
  and cap the envelope, not the subject polygon.
