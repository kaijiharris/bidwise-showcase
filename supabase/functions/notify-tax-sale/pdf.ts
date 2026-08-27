// supabase/functions/notify-tax-sale/pdf.ts
//
// Minimal PDF text extraction for the tax-sale watchdog — no third-party PDF
// dependency (the Deno edge runtime can't run pdfplumber, and a full PDF lib
// is overkill for regexing parcel IDs and sale dates out of county PDFs).
//
// How it reads a PDF:
//   1. Locate every `stream … endstream` segment and FlateDecode it with the
//      web-standard DecompressionStream ("deflate" = zlib, per the PDF spec).
//      Segments that fail to inflate (embedded fonts, uncompressed CMaps) are
//      kept raw. NOTE: the boundary regex needs (?<!end) — "endstream" itself
//      contains "stream" and matching inside it misaligns every later stream.
//   2. Streams containing beginbfchar/beginbfrange are ToUnicode CMaps,
//      parsed into CID → char maps.
//   3. Streams containing Tj/TJ show operators are page content. Text is
//      decoded once per CMap candidate ("union decode"): literal (…) strings
//      pass through as-is; hex <…> CID strings map through the candidate CMap.
//      Callers regex EACH variant and union the matches — a wrong-font decode
//      yields deterministic garbage that never matches a parcel/date pattern,
//      so no font-to-CMap object-graph wiring is needed. Deterministic output
//      is what matters for diffing: same PDF bytes → same parse, every run.
//
// Validated 2026-07-02 against the live Gwinnett (63 PINs + "August 4, 2026")
// and Clayton (26 parcels + "07/07/2026") listing PDFs.

const MAX_PDF_BYTES = 25_000_000
const MAX_STREAMS = 200

function latin1(bytes: Uint8Array): string {
  let s = ""
  const CHUNK = 65536
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return s
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Cast: TS 5.9 types Uint8Array<ArrayBufferLike>, which BlobPart rejects
    // over a hypothetical SharedArrayBuffer backing that can't occur here.
    const blob = new Blob([bytes as unknown as BlobPart])
    const stream = blob.stream().pipeThrough(new DecompressionStream("deflate"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

// All stream segments as latin1 strings (inflated where possible, raw where not).
async function pdfStreams(bytes: Uint8Array): Promise<string[]> {
  if (bytes.length > MAX_PDF_BYTES) return []
  const raw = latin1(bytes)
  const out: string[] = []
  const re = /(?<!end)stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null && out.length < MAX_STREAMS) {
    const start = m.index + m[0].length
    const end = raw.indexOf("endstream", start)
    if (end < 0) break
    // The spec allows an EOL before `endstream`; strict inflaters reject
    // trailing junk, so trim it off the compressed body.
    let trimmed = end
    while (trimmed > start && (raw[trimmed - 1] === "\n" || raw[trimmed - 1] === "\r")) trimmed--
    const body = bytes.subarray(start, trimmed)
    const inflated = await inflate(body)
    out.push(latin1(inflated ?? body))
    re.lastIndex = end + "endstream".length
  }
  return out
}

function hexToStr(hex: string): string {
  let out = ""
  if (hex.length === 2) return String.fromCodePoint(parseInt(hex, 16))
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16))
  }
  return out
}

// ToUnicode CMap → CID → unicode string (bfchar pairs + bfrange runs).
function parseCMap(s: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), hexToStr(pair[2]))
    }
  }
  for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const trip of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(trip[1], 16)
      const hi = parseInt(trip[2], 16)
      const dst = parseInt(trip[3], 16)
      for (let c = lo; c <= hi && c - lo < 65536; c++) {
        map.set(c, String.fromCodePoint(dst + (c - lo)))
      }
    }
  }
  return map
}

// Decode one content stream's show operators against one CID map. Literal
// (…) strings pass through; positioning/end operators become newlines so
// row-per-line structure survives (each table cell is its own BT…ET block).
function decodeContent(s: string, cmap: Map<number, string>): string {
  let out = ""
  let pending: string[] = []
  const tokenRe = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|TJ|Tj|T\*|Td|TD|ET/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(s)) !== null) {
    const t = m[0]
    if (t[0] === "(") {
      pending.push(
        t
          .slice(1, -1)
          .replace(/\\([()\\])/g, "$1")
          .replace(/\\(\d{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
      )
    } else if (t[0] === "<") {
      const hex = t.slice(1, -1).replace(/\s+/g, "")
      let str = ""
      for (let i = 0; i + 4 <= hex.length; i += 4) {
        str += cmap.get(parseInt(hex.slice(i, i + 4), 16)) ?? "�"
      }
      pending.push(str)
    } else if (t === "Tj" || t === "TJ") {
      out += pending.join("")
      pending = []
    } else {
      out += "\n"
      pending = []
    }
  }
  return out
}

// One decoded-text variant per CMap found in the PDF (min one: literal-only).
export async function extractPdfTextVariants(bytes: Uint8Array): Promise<string[]> {
  const streams = await pdfStreams(bytes)
  const cmaps = streams
    .filter((s) => s.includes("beginbfchar") || s.includes("beginbfrange"))
    .map(parseCMap)
  const contents = streams.filter((s) => /\b(Tj|TJ)\b/.test(s) && !s.includes("beginbfchar"))
  const variants = cmaps.length > 0 ? cmaps : [new Map<number, string>()]
  return variants.map((cmap) => contents.map((c) => decodeContent(c, cmap)).join("\n"))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// ── Sale-date helpers ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]

const LONG_DATE_RE = new RegExp(
  `\\b(${MONTH_NAMES.join("|")})\\s+(\\d{1,2})(?:ST|ND|RD|TH)?,?\\s+(\\d{4})\\b`,
  "i"
)

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

// "August 4, 2026" / "November 3rd, 2026" → "2026-08-04". First match wins.
export function longDateToIso(text: string): string | null {
  const m = text.match(LONG_DATE_RE)
  if (!m) return null
  const month = MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1
  return `${m[3]}-${pad2(month)}-${pad2(Number(m[2]))}`
}

// Most frequent mm/dd/yyyy in the text (listing PDFs repeat the sale date on
// every row, so the mode is the sale date — not a "generated on" footer date).
export function modeSlashDateToIso(text: string): string | null {
  const counts = new Map<string, number>()
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const iso = `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`
    counts.set(iso, (counts.get(iso) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [iso, count] of counts) {
    if (count > bestCount) {
      best = iso
      bestCount = count
    }
  }
  return best
}

// "august-2026-tax-sale-web-list" / "july_2026_tax_sale" → { year, month }.
export function monthYearFromText(s: string): { year: number; month: number } | null {
  const m = s.toLowerCase().match(new RegExp(`(${MONTH_NAMES.join("|")})[-_ ]?(\\d{4})`))
  if (!m) return null
  return { year: Number(m[2]), month: MONTH_NAMES.indexOf(m[1]) + 1 }
}

// GA tax sales are held the first Tuesday of the month (statutory), so a
// month-level source (Clayton's "<month>_<year>_tax_sale.pdf") maps to an
// exact date. Verified: Jul 2026 → 07-07 (DeKalb's live sale), Nov 2026 →
// 11-03 (Cobb's announced sale).
export function firstTuesdayIso(year: number, month: number): string {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0 = Sunday
  const day = 1 + ((2 - dow + 7) % 7) // 2 = Tuesday
  return `${year}-${pad2(month)}-${pad2(day)}`
}

// Nearest first-Tuesday on/after today (UTC) — last-resort snapshot key when a
// listing's own sale date can't be parsed. Deterministic within a month.
export function nextFirstTuesdayIso(now: Date): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const thisMonth = firstTuesdayIso(y, m)
  const todayIso = `${y}-${pad2(m)}-${pad2(now.getUTCDate())}`
  if (thisMonth >= todayIso) return thisMonth
  return m === 12 ? firstTuesdayIso(y + 1, 1) : firstTuesdayIso(y, m + 1)
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1]
}
