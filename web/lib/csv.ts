// Shared CSV cell/row builder for exports (server route + client download).
//
// Two jobs, both required for an export of scraped/third-party strings:
//   1. CSV-INJECTION guard (OWASP): a cell that begins with = + - @ (or a tab/CR)
//      is executed as a FORMULA by Excel / Google Sheets / LibreOffice when the
//      file is opened — a real attack vector when owner names / addresses come
//      from scraped county data. Prefix such a cell with a single quote so the
//      spreadsheet treats it as text.
//   2. RFC-4180 quoting: wrap a cell in double-quotes (doubling any internal
//      quote) when it contains a quote, comma, or newline, so commas/quotes in a
//      value never break the column layout.

const FORMULA_LEADERS = /^[=+\-@\t\r]/

/** Sanitize + quote one CSV cell. `null`/`undefined` -> empty string. */
export function csvCell(value: unknown): string {
  if (value == null) return ''
  // A real number is never an injection vector; emit it verbatim so a legit
  // negative value (e.g. ROI -15) isn't turned into text by the '-' guard below.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let str = String(value)
  if (FORMULA_LEADERS.test(str)) str = "'" + str
  if (/[",\n\r]/.test(str)) str = '"' + str.replace(/"/g, '""') + '"'
  return str
}

/** Build one CSV row (comma-joined sanitized cells). */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',')
}
