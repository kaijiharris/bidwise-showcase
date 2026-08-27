/**
 * AuctionCalendar — month-grid module with auction days marked in accent.
 * Rendered as a decorative product module (role="img" with a summary label)
 * so screen readers get the point without 30 day-cells of noise.
 */
export type CalendarMark = {
  day: number
  /** Short mono annotation shown in the legend, e.g. "DEKALB". */
  label?: string
}

type AuctionCalendarProps = {
  /** Month heading, e.g. "AUGUST 2026". */
  month: string
  /** Days in the month. */
  days?: number
  /** Weekday offset of day 1 (0 = Sunday column). */
  startOffset?: number
  marks: CalendarMark[]
  className?: string
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function AuctionCalendar({
  month,
  days = 31,
  startOffset = 0,
  marks,
  className = '',
}: AuctionCalendarProps) {
  const markedDays = new Set(marks.map(m => m.day))
  const summary = `Auction calendar for ${month}: sale days ${marks.map(m => m.day).join(', ')}`

  return (
    <div className={className}>
      <div role="img" aria-label={summary}>
        <div aria-hidden="true" className="mx-auto max-w-md">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="bp-label !text-[var(--bp-text-1)]">{month}</span>
            <span className="bp-label">SALE DAYS: {marks.length}</span>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d, i) => (
              <div key={`${d}-${i}`} className="bp-label pb-1 text-center !text-[10px]">
                {d}
              </div>
            ))}
            {Array.from({ length: startOffset }, (_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1
              const marked = markedDays.has(day)
              return (
                <div
                  key={day}
                  className={`flex h-9 items-center justify-center border font-mono text-[11px] tabular-nums transition-colors ${
                    marked
                      ? 'border-[var(--bp-accent-line)] bg-[var(--bp-accent-soft)] font-semibold text-[var(--bp-accent-bright)]'
                      : 'border-transparent text-[var(--bp-text-3)]'
                  }`}
                >
                  {day}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {marks.some(m => m.label) && (
        <ul className="mx-auto mt-4 max-w-md space-y-1.5 border-t border-[var(--bp-hairline)] pt-3">
          {marks
            .filter(m => m.label)
            .map(m => (
              <li key={`${m.day}-${m.label}`} className="flex items-center justify-between">
                <span className="bp-label flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 bg-[var(--bp-accent)]" />
                  {m.label}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--bp-text-2)]">
                  DAY {String(m.day).padStart(2, '0')}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
