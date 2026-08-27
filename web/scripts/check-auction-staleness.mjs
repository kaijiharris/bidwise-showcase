#!/usr/bin/env node
// Auction-data staleness / empty-feed guard.
//
// Scans web/data/<county>_auctions.json for every known county and flags feeds
// that would render a blank or misleading dashboard tab:
//
//   STALE-GENERATED  — the newest `generated` timestamp across a county's entries
//                       is older than STALE_DAYS. Measured on `generated` (the
//                       scrape time), NEVER on auction_date: a future auction_date
//                       with an old `generated` is still a stale scrape.
//   EMPTY-UPCOMING   — the SOONEST upcoming entry (auction_date >= today) has
//                       total_properties === 0. This is the exact
//                       placeholder-shadows-real-list precondition that renders a
//                       blank tab; catch it at source.
//   MISSING / CORRUPT — the index file is absent, unparseable, or not an array.
//                       Distinct from an empty array so a corrupt index is never
//                       reported as "fresh".
//
// Exit 0 iff every county is fresh, populated-upcoming (or has no upcoming), and
// readable. Exit 1 if ANY county is stale / empty-upcoming / corrupt so CI and
// the control-plane can both consume the exit code. Zero dependencies (Node ESM).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// GA tax sales run ~monthly; scrapers target a weekly cadence. 14 days = two
// missed weekly runs — a defensible threshold before a feed is "stale".
const STALE_DAYS = 14
const KNOWN_COUNTIES = ['dekalb', 'gwinnett', 'cobb', 'clayton']

// Resolve web/data relative to THIS file (scripts/ -> ../data), not cwd, so the
// script works whether invoked from repo root or from web/.
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')

const MS_PER_DAY = 24 * 60 * 60 * 1000

function todayStr(now) {
  return now.toISOString().slice(0, 10)
}

// Parse a `generated` timestamp (ISO, no zone in the data) to epoch ms, or null.
function parseGenerated(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function loadIndex(county) {
  const file = path.join(DATA_DIR, `${county}_auctions.json`)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, reason: 'missing file' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'JSON parse error' }
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not an array' }
  return { ok: true, entries: parsed }
}

// Evaluate one county. Returns a report row with a boolean `flagged`.
function evaluateCounty(county, now) {
  const today = todayStr(now)
  const loaded = loadIndex(county)

  if (!loaded.ok) {
    return { county, verdict: `CORRUPT (${loaded.reason})`, flagged: true, reason: loaded.reason }
  }

  const entries = loaded.entries
  if (entries.length === 0) {
    return { county, verdict: 'CORRUPT (empty index)', flagged: true, reason: 'empty index' }
  }

  // Newest `generated` across ALL entries (max by timestamp, not array position).
  let newestGeneratedMs = null
  let newestGenerated = null
  for (const e of entries) {
    const ms = parseGenerated(e && e.generated)
    if (ms !== null && (newestGeneratedMs === null || ms > newestGeneratedMs)) {
      newestGeneratedMs = ms
      newestGenerated = e.generated
    }
  }

  const ageDays = newestGeneratedMs === null
    ? null
    : Math.floor((now.getTime() - newestGeneratedMs) / MS_PER_DAY)

  // Soonest upcoming entry (auction_date >= today), by date ascending.
  const upcoming = entries
    .filter(e => typeof e?.auction_date === 'string' && e.auction_date >= today)
    .sort((a, b) => a.auction_date.localeCompare(b.auction_date))
  const soonestUpcoming = upcoming[0] ?? null
  const upcomingEmpty = soonestUpcoming !== null && (soonestUpcoming.total_properties ?? 0) === 0

  const stale = ageDays === null || ageDays > STALE_DAYS
  const flagged = stale || upcomingEmpty

  const reasons = []
  if (ageDays === null) reasons.push('no valid `generated` timestamp')
  else if (stale) reasons.push(`generated ${ageDays}d ago (> ${STALE_DAYS}d)`)
  if (upcomingEmpty) reasons.push(`soonest upcoming ${soonestUpcoming.auction_date} has 0 properties`)

  return {
    county,
    newestGenerated,
    ageDays,
    soonestUpcoming: soonestUpcoming ? soonestUpcoming.auction_date : null,
    upcomingEmpty,
    verdict: flagged ? `STALE (${reasons.join('; ')})` : 'FRESH',
    flagged,
  }
}

function formatRow(r) {
  const age = r.ageDays === null ? 'n/a' : `${r.ageDays}d`
  const soon = r.soonestUpcoming ?? 'none'
  const gen = r.newestGenerated ?? 'n/a'
  const mark = r.flagged ? 'x' : 'ok'
  return `[${mark}] ${r.county.padEnd(9)} generated=${gen}  age=${age.padStart(4)}  soonestUpcoming=${soon.padEnd(10)}  upcomingEmpty=${String(!!r.upcomingEmpty).padEnd(5)}  ${r.verdict}`
}

function main() {
  const now = new Date()
  const rows = KNOWN_COUNTIES.map(c => evaluateCounty(c, now))

  console.log(`Auction staleness check — ${todayStr(now)} (STALE_DAYS=${STALE_DAYS})`)
  console.log(`Data dir: ${DATA_DIR}`)
  console.log('')
  for (const r of rows) console.log(formatRow(r))
  console.log('')

  const flagged = rows.filter(r => r.flagged)
  if (flagged.length === 0) {
    console.log('All county feeds fresh and populated. OK.')
    process.exit(0)
  }
  console.error(`FAIL: ${flagged.length} county feed(s) flagged: ${flagged.map(r => r.county).join(', ')}`)
  process.exit(1)
}

main()
