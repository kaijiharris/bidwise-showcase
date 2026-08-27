'use client'

/**
 * CountUp — count-up numeral on scroll into view. Renders the final value on
 * the server (SEO / no-JS safe) and only animates when the visitor allows
 * motion. Transform/opacity-free: we mutate textContent inside rAF.
 */
import { useEffect, useRef } from 'react'

type CountUpProps = {
  end: number
  /** Animation length in ms. */
  duration?: number
  /** Zero-pad width, e.g. pad=2 renders 3 as "03" (survey-stamp style). */
  pad?: number
  prefix?: string
  suffix?: string
  className?: string
}

const EASE_OUT_CUBIC = (p: number) => 1 - Math.pow(1 - p, 3)

export default function CountUp({
  end,
  duration = 1400,
  pad = 0,
  prefix = '',
  suffix = '',
  className = '',
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const render = (n: number) => {
      el.textContent = `${prefix}${String(n).padStart(pad, '0')}${suffix}`
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        const t0 = performance.now()
        const tick = (t: number) => {
          const p = Math.min((t - t0) / duration, 1)
          render(Math.round(EASE_OUT_CUBIC(p) * end))
          if (p < 1) frame = requestAnimationFrame(tick)
        }
        render(0)
        frame = requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [end, duration, pad, prefix, suffix])

  return (
    <span ref={ref} className={className}>
      {prefix}
      {String(end).padStart(pad, '0')}
      {suffix}
    </span>
  )
}
