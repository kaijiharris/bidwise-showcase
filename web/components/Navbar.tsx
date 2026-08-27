'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_FREE_LIST_COUNTY } from '@/lib/free-list'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [user, setUser] = useState<{ email?: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setUser(data.user)
      setAuthLoading(false)
    })
  }, [])

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const links = [
    { label: 'How It Works', href: '/how-it-works' },
    { label: 'Pricing',      href: '/pricing' },
    // Free county list — the one no-card taste of the product. Points at the
    // county with the nearest upcoming auction (lib/free-list).
    { label: 'Free List',    href: `/free-list/${DEFAULT_FREE_LIST_COUNTY}` },
    { label: 'Resources',    href: '/resources' },
    { label: 'FAQ',          href: '/faq' },
  ]

  const close = () => setOpen(false)

  const handleSignOut = async () => {
    await createClient().auth.signOut()
    setUser(null)
    close()
    // Hard navigation so the server re-evaluates auth (clears any cached
    // session state) and lands the user on the public home page.
    window.location.href = '/'
  }

  // Blueprint Instrument chrome (2026-07-08): survey-stamp mono nav voice,
  // electric-blue (#3B82F6 via --bp-accent) as the ONLY accent, hairline
  // linework. Focus-visible outlines mirror .bp-btn-* for a consistent kit.
  const focusRing =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--bp-accent-bright)]'

  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
      scrolled
        ? 'bg-[rgba(11,14,20,0.85)] backdrop-blur-xl border-b border-[var(--bp-hairline)] shadow-[0_1px_0_var(--bp-hairline)]'
        : 'bg-transparent'
    }`}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo — original BidWise wordmark, untouched (accent glow on hover) */}
          <Link href="/" onClick={close} className={`shrink-0 group rounded-[3px] ${focusRing}`}>
            <Image
              src="/logo-wordmark.png"
              alt="BidWise"
              width={1536}
              height={1024}
              className="h-14 w-auto object-contain group-hover:drop-shadow-[0_0_12px_rgba(59,130,246,0.45)] transition-all"
              priority
            />
          </Link>

          {/* Desktop nav links — mono survey-stamp voice with draw-in underline */}
          <div className="hidden md:flex items-center">
            {links.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`group relative px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--bp-text-2)] rounded-[3px] transition-colors hover:text-[var(--bp-text-1)] focus-visible:text-[var(--bp-text-1)] ${focusRing}`}
              >
                {l.label}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-3 bottom-1 h-px origin-left scale-x-0 bg-[var(--bp-accent)] transition-transform duration-200 group-hover:scale-x-100 group-focus-visible:scale-x-100 motion-reduce:transition-none"
                />
              </Link>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            {authLoading ? (
              <div className="w-[140px] h-8" />
            ) : user ? (
              <>
                <button
                  onClick={handleSignOut}
                  className={`px-4 py-2 text-sm font-semibold text-[var(--bp-text-2)] rounded-[3px] transition-colors hover:text-[var(--bp-text-1)] ${focusRing}`}
                >
                  Sign Out
                </button>
                <Link href="/dashboard" className="bp-btn-primary px-5 py-2 text-sm">
                  Dashboard →
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className={`px-4 py-2 text-sm font-semibold text-[var(--bp-text-2)] rounded-[3px] transition-colors hover:text-[var(--bp-text-1)] ${focusRing}`}>
                  Sign In
                </Link>
                <Link href="/signup" className="bp-btn-primary px-5 py-2 text-sm">
                  Start Free Trial
                </Link>
              </>
            )}
          </div>

          {/* Mobile right — Sign In shortcut + hamburger */}
          <div className="md:hidden flex items-center gap-1">
            {!authLoading && (
              user ? (
                <Link
                  href="/dashboard"
                  onClick={close}
                  className={`px-3 py-2 text-sm font-semibold text-[var(--bp-accent)] rounded-[3px] transition-colors hover:text-[var(--bp-accent-bright)] touch-manipulation ${focusRing}`}
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  onClick={close}
                  className={`px-3 py-2 text-sm font-semibold text-[var(--bp-text-2)] rounded-[3px] transition-colors hover:text-[var(--bp-text-1)] touch-manipulation ${focusRing}`}
                >
                  Sign In
                </Link>
              )
            )}
            <button
              onClick={() => setOpen(o => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className={`p-2.5 text-[var(--bp-text-2)] transition-colors rounded-[4px] hover:text-[var(--bp-text-1)] hover:bg-[var(--bp-accent-soft)] active:bg-[var(--bp-accent-soft)] touch-manipulation ${focusRing}`}
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>

        </div>
      </div>

      {/* Mobile drawer — full-screen overlay */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 top-16 bg-black/60 z-40"
            onClick={close}
          />

          {/* Panel */}
          <div className="md:hidden relative z-50 animate-slide-down motion-reduce:animate-none bg-[var(--bp-panel-deep)] border-t border-[var(--bp-hairline)] shadow-2xl">
            <div className="max-w-6xl mx-auto px-5 py-3">

              <p className="bp-label px-4 pt-3 pb-1">Navigation</p>

              {/* Nav links */}
              <nav className="space-y-0.5">
                {links.map(l => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={close}
                    className={`flex items-center px-4 py-4 font-mono text-[13px] uppercase tracking-[0.12em] text-[var(--bp-text-2)] hover:text-[var(--bp-text-1)] hover:bg-[var(--bp-accent-soft)] active:bg-[var(--bp-accent-soft)] rounded-[4px] transition-colors touch-manipulation ${focusRing}`}
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>

              {/* Auth CTAs */}
              <div className="mt-3 pt-4 border-t border-[var(--bp-hairline)] space-y-2.5 pb-6">
                {authLoading ? null : user ? (
                  <>
                    <Link
                      href="/dashboard"
                      onClick={close}
                      className="flex items-center justify-center w-full py-4 bp-btn-primary text-sm font-semibold touch-manipulation"
                    >
                      Go to Dashboard →
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="bp-btn-ghost flex items-center justify-center w-full py-4 text-sm font-semibold active:scale-[0.98] touch-manipulation"
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      onClick={close}
                      className="bp-btn-ghost flex items-center justify-center w-full py-4 text-sm font-semibold active:scale-[0.98] touch-manipulation"
                    >
                      Sign In
                    </Link>
                    <Link
                      href="/signup"
                      onClick={close}
                      className="flex items-center justify-center w-full py-4 bp-btn-primary text-sm font-semibold active:scale-[0.98] touch-manipulation"
                    >
                      Start Free Trial
                    </Link>
                  </>
                )}
              </div>

            </div>
          </div>
        </>
      )}
    </nav>
  )
}
