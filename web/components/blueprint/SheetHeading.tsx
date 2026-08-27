/**
 * SheetHeading — the Blueprint Instrument section header: a mono "sheet"
 * eyebrow, an oversized display title, optional sub-copy, and an optional
 * right-aligned mono link. Mirrors the homepage's section-heading voice so
 * every marketing surface reads as the same instrument set. Colors come from
 * the bp CSS variables, so it inverts inside the paper-white chapter.
 */
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

type SheetHeadingProps = {
  /** Mono sheet label, e.g. "SHT 02 · PROCEDURE". */
  sheet: string
  /** id for the heading (paired with the section's aria-labelledby). */
  id: string
  title: React.ReactNode
  sub?: string
  /** Optional right-aligned mono link, e.g. full comparison. */
  link?: { href: string; label: string }
  className?: string
}

export default function SheetHeading({ sheet, id, title, sub, link, className = '' }: SheetHeadingProps) {
  return (
    <div className={`mb-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between ${className}`}>
      <div className="max-w-2xl">
        <p className="bp-label mb-5 !text-[var(--bp-accent)]">{sheet}</p>
        <h2 id={id} className="text-4xl font-bold tracking-tight text-[var(--bp-text-1)] sm:text-5xl">
          {title}
        </h2>
        {sub && <p className="mt-4 max-w-xl text-lg leading-relaxed text-[var(--bp-text-2)]">{sub}</p>}
      </div>
      {link && (
        <Link
          href={link.href}
          className="bp-label inline-flex shrink-0 items-center gap-2 !text-[var(--bp-accent)] transition-colors hover:!text-[var(--bp-text-1)]"
        >
          {link.label} <ArrowRight size={13} aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}
