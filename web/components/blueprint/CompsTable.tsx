/**
 * CompsTable — comparable-sales module in survey-ledger style: mono header
 * row, hairline dividers, tabular numerals, hover row highlight.
 */
export type CompRow = {
  address: string
  distance: string
  price: string
}

type CompsTableProps = {
  rows: CompRow[]
  /** Column headings — defaults match the live dashboard comps panel. */
  columns?: [string, string, string]
  /** Mono footnote under the table, e.g. confidence note. */
  footnote?: string
  className?: string
}

export default function CompsTable({
  rows,
  columns = ['COMP', 'DIST', 'SOLD'],
  footnote,
  className = '',
}: CompsTableProps) {
  return (
    <div className={className}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--bp-hairline)]">
            <th scope="col" className="bp-label pb-2.5 pr-3 font-medium">
              {columns[0]}
            </th>
            <th scope="col" className="bp-label pb-2.5 pr-3 text-right font-medium">
              {columns[1]}
            </th>
            <th scope="col" className="bp-label pb-2.5 text-right font-medium">
              {columns[2]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.address}
              className="border-b border-[var(--bp-hairline)] transition-colors last:border-b-0 hover:bg-[var(--bp-accent-soft)]"
            >
              <td className="max-w-0 truncate py-3 pr-3 font-mono text-[12px] tracking-[0.04em] text-[var(--bp-text-2)]">
                {row.address}
              </td>
              <td className="py-3 pr-3 text-right font-mono text-[12px] tabular-nums text-[var(--bp-text-3)]">
                {row.distance}
              </td>
              <td className="py-3 text-right font-mono text-[13px] font-semibold tabular-nums text-[var(--bp-text-1)]">
                {row.price}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footnote && <p className="bp-label mt-4 flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--bp-accent)]" />
        {footnote}
      </p>}
    </div>
  )
}
