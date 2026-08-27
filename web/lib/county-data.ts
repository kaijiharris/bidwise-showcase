// Server-only access to the pipeline JSON datasets.
//
// These files used to live under web/public/data and were web-served to anyone
// (paywall leak). They now live under web/data/ and are read ONLY from server
// code (this module) — never bundled to the client, never statically served.
//
// IMPORTANT: do not import this file from any client component. It uses node:fs.

import { promises as fs } from 'fs'
import path from 'path'
import { pickDefaultEntry } from './auction-select'

// Resolve against the web/ project root. process.cwd() is the project root in
// both `next dev` and the Vercel serverless runtime.
const DATA_DIR = path.join(process.cwd(), 'data')

// Slugs we serve. Anything else is rejected before any fs access so a crafted
// `county` segment can never escape DATA_DIR.
export const KNOWN_COUNTIES = ['dekalb', 'gwinnett', 'cobb', 'clayton'] as const
export type CountySlug = (typeof KNOWN_COUNTIES)[number]

export function isKnownCounty(slug: string): slug is CountySlug {
  return (KNOWN_COUNTIES as readonly string[]).includes(slug)
}

export interface AuctionIndexEntry {
  auction_date: string
  label: string
  file: string
  total_properties: number
  residential: number
  multi_family: number
  commercial: number
  land: number
  top_deals: number
  generated: string
}

// A data file name is a bare JSON filename like "dekalb.json" or
// "dekalb_2026-06-02.json". We never accept paths — only [a-z0-9_-].json — so a
// value coming from the auction index (or a query param) cannot traverse out of
// DATA_DIR.
const SAFE_FILE_RE = /^[a-z0-9][a-z0-9_-]*\.json$/i

function fileNameFromIndexPath(p: string): string | null {
  // Index entries store web paths like "/data/dekalb.json". Take the basename.
  const base = p.split('/').pop() ?? ''
  return SAFE_FILE_RE.test(base) ? base : null
}

async function readJsonFile(fileName: string): Promise<unknown> {
  const full = path.join(DATA_DIR, fileName)
  // Defense in depth: ensure the resolved path is still inside DATA_DIR.
  if (!full.startsWith(DATA_DIR + path.sep)) {
    throw new Error(`refusing to read outside data dir: ${fileName}`)
  }
  const raw = await fs.readFile(full, 'utf8')
  return JSON.parse(raw)
}

export async function readAuctionIndex(
  county: CountySlug,
): Promise<AuctionIndexEntry[]> {
  try {
    const data = await readJsonFile(`${county}_auctions.json`)
    return Array.isArray(data) ? (data as AuctionIndexEntry[]) : []
  } catch {
    return []
  }
}

// Resolve which data file to serve for a county.
//   - If `requestedFile` is supplied it MUST appear in the auction index (so a
//     caller can only request files we actually publish for that county).
//   - Otherwise pick the most-recent auction that has properties, falling back
//     to the newest entry.
//
// The legacy `{county}.json` is ONLY honored when no auction index exists yet
// (fresh deploy before the first pipeline run). Once an index is present, every
// served file must be referenced by it — an arbitrary index-absent filename
// (even the legacy default) is rejected so a caller cannot reach an old,
// un-curated snapshot that the index no longer points to.
export async function resolveDataFile(
  county: CountySlug,
  requestedFile?: string | null,
): Promise<{ fileName: string; entry: AuctionIndexEntry | null } | null> {
  const index = await readAuctionIndex(county)
  const hasIndex = index.length > 0

  if (requestedFile) {
    const wanted = fileNameFromIndexPath(requestedFile) ?? (SAFE_FILE_RE.test(requestedFile) ? requestedFile : null)
    if (!wanted) return null
    const entry = index.find(e => fileNameFromIndexPath(e.file) === wanted) ?? null
    if (entry) return { fileName: wanted, entry }
    // No index yet → allow the legacy default only. With an index present, a
    // file it does not reference is never served.
    if (!hasIndex && wanted === `${county}.json`) return { fileName: wanted, entry: null }
    return null
  }

  if (hasIndex) {
    const populated = pickDefaultEntry(index)
    const fileName = fileNameFromIndexPath(populated.file)
    if (fileName) return { fileName, entry: populated }
    // Index exists but its entries have unusable file paths — fail closed
    // rather than silently serving the legacy snapshot.
    return null
  }

  return { fileName: `${county}.json`, entry: null }
}

export interface RawCountyDataset {
  properties: Record<string, unknown>[]
  comparables: Record<string, unknown>[]
  total_properties: number | null
  county: string | null
  analysis_date: string | null
  auction_date: string | null
}

export async function readCountyDataset(
  county: CountySlug,
  fileName: string,
): Promise<RawCountyDataset> {
  const data = await readJsonFile(fileName)
  if (Array.isArray(data)) {
    return {
      properties: data as Record<string, unknown>[],
      comparables: [],
      total_properties: data.length,
      county,
      analysis_date: null,
      auction_date: null,
    }
  }
  const obj = (data ?? {}) as Record<string, unknown>
  return {
    properties: Array.isArray(obj.properties) ? (obj.properties as Record<string, unknown>[]) : [],
    comparables: Array.isArray(obj.comparables) ? (obj.comparables as Record<string, unknown>[]) : [],
    total_properties: typeof obj.total_properties === 'number' ? obj.total_properties : null,
    county: typeof obj.county === 'string' ? obj.county : county,
    analysis_date: typeof obj.analysis_date === 'string' ? obj.analysis_date : null,
    auction_date: typeof obj.auction_date === 'string' ? obj.auction_date : null,
  }
}
