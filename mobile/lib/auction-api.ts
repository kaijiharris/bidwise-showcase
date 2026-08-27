import { supabase } from './supabase'
import { normalizeData } from './normalize'
import { captureError } from './sentry'
import type { AuctionEntry, AuctionMeta, County, NormalizedProperty } from './types'

const DEFAULT_APP_URL = 'https://bidwiseinvest.com'
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, '')

// A typed error for the deals data layer. `message` is safe to show a user
// (short, non-technical, no URLs or headers); `detail` carries the diagnostic
// context (status, final URL, content-type) for Sentry / console only.
export type DealsErrorKind = 'auth' | 'not-found' | 'config' | 'network' | 'server'

export class DealsFetchError extends Error {
  readonly kind: DealsErrorKind
  readonly status?: number
  readonly detail: string

  constructor(kind: DealsErrorKind, message: string, detail: string, status?: number) {
    super(message)
    this.name = 'DealsFetchError'
    this.kind = kind
    this.status = status
    this.detail = detail
  }
}

// Map a raw HTTP/parse condition to a user-facing message + diagnostic detail.
// Pure and exported so it can be unit-tested without a network round-trip.
export function classifyDealsResponse(input: {
  status: number
  ok: boolean
  contentType: string | null
  finalUrl: string
  redirected: boolean
}): { kind: DealsErrorKind; message: string; detail: string } | null {
  const { status, ok, contentType, finalUrl, redirected } = input
  const ct = contentType ?? 'no content-type'

  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      message: 'Your session expired. Sign out and back in to reload deals.',
      detail: `${status} at ${finalUrl}`,
    }
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      message: 'No deals are published for this county yet.',
      detail: `404 at ${finalUrl}`,
    }
  }
  if (!ok) {
    return {
      kind: 'server',
      message: 'The deals service is temporarily unavailable. Pull down to retry.',
      detail: `${status} at ${finalUrl}`,
    }
  }
  // 2xx but not JSON: almost always an auth wall / error page / wrong host
  // returning "<!DOCTYPE html>", which would blow up as the opaque native
  // "JSON Parse error: Unexpected character: <". Surface a real message instead.
  if (!ct.includes('application/json')) {
    const where = redirected ? `redirected to ${finalUrl}` : `final URL ${finalUrl}`
    return {
      kind: 'config',
      message: "We couldn't reach the deals service. Pull down to retry.",
      detail: `expected JSON, got ${ct} (${where}) — likely a misconfigured API host or auth redirect to an HTML page`,
    }
  }
  return null
}

// Attach the Supabase access token so the web data API can return tier-masked
// properties (financials null when locked, per-property `unlocked` flag).
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

// Build a DealsFetchError, ship its diagnostic `detail` to Sentry (users only
// ever see the friendly `message`), and throw. Centralized so every failure
// path reports consistently.
function throwDeals(
  kind: DealsErrorKind,
  message: string,
  detail: string,
  status?: number
): never {
  const err = new DealsFetchError(kind, message, detail, status)
  captureError(err, { kind, status, detail, apiBase: APP_URL })
  throw err
}

async function getJSON<T>(url: string): Promise<T> {
  const headers = await authHeaders()

  let res: Response
  try {
    res = await fetch(url, { headers, cache: 'no-store' as RequestCache })
  } catch (e) {
    // fetch() itself rejected (DNS, TLS, offline, connection refused — e.g. a
    // stale build baked at a LAN dev URL that is unreachable off-network).
    const detail = e instanceof Error ? e.message : String(e)
    throwDeals(
      'network',
      'No connection to the deals service. Check your network and pull down to retry.',
      `fetch failed for ${url}: ${detail}`
    )
  }

  const problem = classifyDealsResponse({
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type'),
    finalUrl: res.url || url,
    redirected: res.redirected,
  })
  if (problem) {
    throwDeals(problem.kind, problem.message, problem.detail, res.status)
  }

  // Content-type says JSON, but a truncated/garbled body can still fail to
  // parse. Catch it so it never surfaces as a raw native parse error.
  try {
    return (await res.json()) as T
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throwDeals(
      'config',
      "We couldn't read the deals response. Pull down to retry.",
      `JSON parse failed for ${url}: ${detail}`
    )
  }
}

export async function fetchAuctionIndex(county: County['slug']): Promise<AuctionEntry[]> {
  // The auction index (list of auction dates) is served by the authenticated
  // data API so every request carries the bearer token.
  const url = `${APP_URL}/api/data/${county}/auctions`
  try {
    const entries = await getJSON<AuctionEntry[]>(url)
    return Array.isArray(entries) ? entries : []
  } catch (e) {
    // A county with no published auctions 404s here — that is an empty index,
    // not an error the user needs to see (the data query below still runs and
    // reports its own failure if the properties endpoint is down).
    if (e instanceof DealsFetchError && e.kind === 'not-found') return []
    throw e
  }
}

interface FetchAuctionOptions {
  /**
   * Path returned by AuctionEntry.file (e.g. "/data/dekalb_2026-05-05.json")
   * OR a bare county slug fallback. Used to derive the auction query param.
   */
  file: string
  /** County slug — drives the authenticated endpoint and normalization. */
  county: County['slug']
}

// The authenticated endpoint selects a specific published dataset via the
// `file` query param — a bare JSON filename from the auction index — exactly
// like the web dashboard (DashboardClient sends `?file=<basename>`). The server
// validates the value against the county's auction index before reading, so a
// crafted name cannot escape the data dir. We pass the basename of
// AuctionEntry.file (e.g. "/data/dekalb_2026-05-05.json" → "dekalb_2026-05-05.json").
function fileParamFromPath(file: string): string | null {
  const base = file.split('/').pop()?.trim()
  return base && base.endsWith('.json') ? base : null
}

export async function fetchAuctionProperties(
  opts: FetchAuctionOptions
): Promise<{ props: NormalizedProperty[]; meta: AuctionMeta }> {
  // Authenticated, tier-masked endpoint. The optional `file` query param
  // selects a specific auction's dataset when the caller picked one from the index.
  const fileParam = fileParamFromPath(opts.file)
  const base = `${APP_URL}/api/data/${opts.county}`
  const params = new URLSearchParams()
  if (fileParam) params.set('file', fileParam)
  // Cache-buster matches the web dashboard's pattern.
  params.set('v', String(Date.now()))
  const url = `${base}?${params.toString()}`

  const data = await getJSON<unknown>(url)
  return normalizeData(data as Parameters<typeof normalizeData>[0], opts.county)
}
