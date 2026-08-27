import { Lock } from 'lucide-react'
import type { TeaserRow } from '@/lib/free-list'

// Pure presentational server component: receives ALREADY-MASKED rows from
// lib/free-list buildTeaserRows() and renders them. It never touches the raw
// dataset, so the exact addresses / ARVs / deal scores physically cannot end
// up in the HTML it produces (tests/free-list.test.ts renders this to static
// markup and asserts exactly that).

const fmtMoney = (v: number | null) =>
  v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US')

function LockedCell() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-semibold text-slate-500">
      <Lock size={10} aria-hidden />
      Locked
    </span>
  )
}

export default function TeaserTable({ rows }: { rows: TeaserRow[] }) {
  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left">
          <thead>
            <tr className="bg-white/5 border-b border-white/10">
              {['Parcel', 'Address', 'City', 'Type', 'Taxes due', 'Est. value', 'Deal score', 'Max bid'].map(h => (
                <th
                  key={h}
                  scope="col"
                  className="px-4 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`${row.parcelMasked}-${i}`}
                className={`border-b border-white/5 ${i % 2 === 0 ? '' : 'bg-white/2'}`}
              >
                <td className="px-4 py-3 text-xs font-mono text-slate-500 whitespace-nowrap">
                  {row.parcelMasked}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-200 whitespace-nowrap">
                  {row.addressMasked}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                  {row.city ?? '—'}
                  {row.city && row.state ? `, ${row.state}` : ''}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {row.propertyType ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-300 whitespace-nowrap">
                  {fmtMoney(row.taxDue)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {row.valueBand ? (
                    <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-bold border border-[#10A7FF]/30 bg-[#10A7FF]/10 text-[#2DE2FF]">
                      {row.valueBand}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <LockedCell />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <LockedCell />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
