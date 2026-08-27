'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Menu, X, Settings2, Check, Copy } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { TRIAL_LABEL } from '@/lib/trial'

// Register ScrollTrigger
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

function useMagneticButton(
  ref: React.RefObject<HTMLAnchorElement | HTMLButtonElement | HTMLDivElement | null>,
) {
  useEffect(() => {
    // Only apply on desktop
    if (window.innerWidth < 768 || !ref.current) return

    const btn = ref.current
    const handleMouseMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      // 0.3 pull factor
      gsap.to(btn, {
        x: (e.clientX - cx) * 0.3,
        y: (e.clientY - cy) * 0.3,
        duration: 0.4,
        ease: 'power3.out'
      })
    }
    const handleMouseLeave = () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.3)' })
    }

    btn.addEventListener('mousemove', handleMouseMove as EventListener)
    btn.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      btn.removeEventListener('mousemove', handleMouseMove as EventListener)
      btn.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [ref])
}

function AnimatedHeading({ text, delay = 200, charDelay = 30 }: { text: string; delay?: number; charDelay?: number }) {
  const [start, setStart] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setStart(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  let totalChars = 0

  return (
    <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold mb-4 text-white origin-left" style={{
      letterSpacing: '-0.04em',
      transform: 'scale(var(--tweak-title-scale, 1))',
      textShadow: '0 4px 30px rgba(0,0,0,calc(var(--tweak-title-shadow, 0.7) + 0.2)), 0 2px 10px rgba(0,0,0,var(--tweak-title-shadow, 0.7)), 0 0 60px rgba(0,0,0,calc(var(--tweak-title-shadow, 0.7) - 0.2))'
    }}>
      {text.split('\n').map((line, lineIdx) => {
        return (
          <div key={lineIdx}>
            {/* Chars are grouped per word inside whitespace-nowrap inline-block
                spans so the browser only wraps at word boundaries. Bare per-char
                inline-block spans destroy word boundaries and let narrow
                viewports (320px) break mid-word ("numb / er"). */}
            {line.split(' ').map((word, wordIdx) => {
              if (wordIdx > 0) totalChars++ // keep the stagger slot the space occupied
              return (
                <React.Fragment key={wordIdx}>
                  {wordIdx > 0 && ' '}
                  <span className="inline-block whitespace-nowrap">
                    {word.split('').map((char, charIdx) => {
                      const transitionDelay = `${totalChars++ * charDelay}ms`
                      return (
                        <span
                          key={charIdx}
                          className="inline-block transition-all duration-500 ease-out"
                          style={{
                            opacity: start ? 1 : 0,
                            transform: start ? 'translateX(0)' : 'translateX(-18px)',
                            transitionDelay
                          }}
                        >
                          {char}
                        </span>
                      )
                    })}
                  </span>
                </React.Fragment>
              )
            })}
          </div>
        )
      })}
    </h1>
  )
}

function FadeIn({ children, delay = 800, duration = 1000, className = '' }: { children: React.ReactNode, delay?: number, duration?: number, className?: string }) {
  const [start, setStart] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setStart(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  return (
    <div
      className={`transition-opacity ${className}`}
      style={{
        opacity: start ? 1 : 0,
        transitionDuration: `${duration}ms`
      }}
    >
      {children}
    </div>
  )
}

interface Tweaks {
  titleScale: number
  titleShadowOpacity: number
  heroPaddingBottom: number
  glassBlur: number
  glassOpacity: number
  cardScale: number
  charDelay: number
  ctaGlow: number
  bgOverlayOpacity: number
  borderOpacity: number
}

const TweakPanel = ({ tweaks, setTweaks }: { tweaks: Tweaks; setTweaks: React.Dispatch<React.SetStateAction<Tweaks>> }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyConfig = () => {
    navigator.clipboard.writeText(JSON.stringify(tweaks, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="fixed bottom-4 right-4 z-[9999] bg-indigo-600 text-white p-3 rounded-full shadow-lg">
        <Settings2 size={24} />
      </button>
    )
  }

  const ranges = {
    titleScale: { min: 0.5, max: 2, step: 0.05 },
    titleShadowOpacity: { min: 0, max: 1, step: 0.1 },
    heroPaddingBottom: { min: 0, max: 200, step: 4 },
    glassBlur: { min: 0, max: 64, step: 1 },
    glassOpacity: { min: 0, max: 1, step: 0.05 },
    cardScale: { min: 0.5, max: 1.5, step: 0.05 },
    charDelay: { min: 0, max: 100, step: 5 },
    ctaGlow: { min: 0, max: 100, step: 5 },
    bgOverlayOpacity: { min: 0, max: 1, step: 0.05 },
    borderOpacity: { min: 0, max: 1, step: 0.05 }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] bg-[#0f1115] border border-white/10 text-white w-80 rounded-xl shadow-2xl p-4 font-mono text-xs overflow-y-auto max-h-[80vh]">
      <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
        <h3 className="font-bold flex items-center gap-2">Tweak Max <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 rounded text-[10px]">LIVE</span></h3>
        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white"><X size={16} /></button>
      </div>
      <div className="space-y-4">
        {Object.entries(tweaks).map(([key, val]) => (
          <div key={key}>
            <div className="flex justify-between mb-1 text-gray-400">
              <span>{key}</span>
              <span style={{ color: '#10A7FF' }}>{val}</span>
            </div>
            <input
              type="range"
              {...ranges[key as keyof typeof ranges]}
              value={val}
              onChange={(e) => setTweaks((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))}
              className="w-full accent-indigo-500"
            />
          </div>
        ))}
      </div>
      <button onClick={copyConfig} className="mt-6 w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded flex items-center justify-center gap-2 transition-colors">
        {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy Config JSON</>}
      </button>
    </div>
  )
}

export default function HeroSection() {
  const heroRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLAnchorElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoReady, setVideoReady] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tweaks, setTweaks] = useState<Tweaks>({
    titleScale: 1,
    titleShadowOpacity: 0.7,
    heroPaddingBottom: 64,
    glassBlur: 20,
    glassOpacity: 0.88,
    cardScale: 1,
    charDelay: 16,
    ctaGlow: 0,
    bgOverlayOpacity: 0.2,
    borderOpacity: 0.1,
  })

  useMagneticButton(ctaRef)

  // Force the background video to autoplay on mobile. React doesn't reliably set
  // the `muted` *property* on the DOM node before play, so iOS Safari / Android
  // Chrome silently block the autoplay attribute. Set it imperatively, then call
  // play() and — if the browser still refuses (e.g. iOS Low Power Mode) — retry
  // once on the first user interaction.
  //
  // Reveal (fade in) the video as soon as its first frame is decoded — NOT only
  // once it is `playing`. Mobile browsers can refuse autoplay entirely, in which
  // case `playing` never fires; gating visibility on it would leave a permanent
  // black hero. Revealing on first-frame-ready shows the video immediately and it
  // starts moving the moment the browser allows it (or on first interaction).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    v.playsInline = true

    // Serve a lightweight 720p clip (~1MB) to phones. The 4K web clip is ~14MB
    // and many mobile browsers (esp. iOS Safari) won't auto-download/play a file
    // that large, which left the hero black. Source is chosen here in JS because
    // the `media` attribute on <source> is unreliable in Safari. Setting `src`
    // also guarantees phones never request the heavy desktop file.
    const isMobile = window.matchMedia('(max-width: 768px)').matches
    v.src = isMobile ? '/videos/hero_mobile.mp4' : '/videos/hero_sharpened_4k_web.mp4'
    v.load()

    const reveal = () => setVideoReady(true)
    const tryPlay = () => { v.play().catch(() => {}) }
    const onCanPlay = () => { reveal(); tryPlay() }

    // If a frame is already buffered (fast cache / re-render), reveal now.
    if (v.readyState >= 2) reveal()

    v.addEventListener('loadeddata', reveal)
    v.addEventListener('canplay', onCanPlay)
    v.addEventListener('playing', reveal)

    tryPlay()

    const onFirstInteract = () => {
      tryPlay()
      window.removeEventListener('touchstart', onFirstInteract)
      window.removeEventListener('click', onFirstInteract)
    }
    window.addEventListener('touchstart', onFirstInteract, { once: true, passive: true })
    window.addEventListener('click', onFirstInteract, { once: true })

    // Safety net: never leave the hero black. If no media event fired (e.g. a
    // browser that suppresses them under data-saver), reveal anyway after 2.5s.
    const fallback = window.setTimeout(reveal, 2500)

    return () => {
      v.removeEventListener('loadeddata', reveal)
      v.removeEventListener('canplay', onCanPlay)
      v.removeEventListener('playing', reveal)
      window.removeEventListener('touchstart', onFirstInteract)
      window.removeEventListener('click', onFirstInteract)
      window.clearTimeout(fallback)
    }
  }, [])

  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  useEffect(() => {
    if (!heroRef.current || !contentRef.current) return

    const ctx = gsap.context(() => {
      // Hero text fades out on scroll
      gsap.to(contentRef.current, {
        opacity: 0,
        y: -60,
        ease: 'none',
        scrollTrigger: {
          trigger: heroRef.current,
          start: '10% top',
          end: '35% top',
          scrub: true
        }
      })
    }, heroRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={heroRef} className="relative min-h-[100dvh] flex flex-col bg-black overflow-hidden hero"
      style={{
        '--tweak-title-scale': tweaks.titleScale,
        '--tweak-title-shadow': tweaks.titleShadowOpacity,
        '--tweak-hero-pb': `${tweaks.heroPaddingBottom}px`,
        '--tweak-glass-blur': `${tweaks.glassBlur}px`,
        '--tweak-glass-opacity': tweaks.glassOpacity,
        '--tweak-card-scale': tweaks.cardScale,
        '--tweak-cta-glow': `0 0 ${tweaks.ctaGlow}px rgba(255,255,255,${tweaks.ctaGlow / 100})`,
        '--tweak-bg-overlay': tweaks.bgOverlayOpacity,
        '--tweak-border-opacity': tweaks.borderOpacity,
      } as React.CSSProperties}
    >
      {/* TweakPanel — dev only */}
      {process.env.NODE_ENV === 'development' && <TweakPanel tweaks={tweaks} setTweaks={setTweaks} />}

      {/* Poster — the real first frame of the clip, painted instantly as a CSS
          background so the hero is never a black void while the video buffers
          (or when autoplay is refused). The video fades in over it; since the
          poster IS frame zero, the crossfade is seamless. */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/videos/hero_poster.jpg')" }}
      />
      {/* Background Video — `src` is set in the effect above (720p for phones,
          4K for desktop). No <source> child: with preload="auto" it would make
          phones start fetching the 14MB desktop file at parse time. */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-700 ease-out"
        style={{ opacity: videoReady ? 1 : 0 }}
      />
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ background: 'black', opacity: 'var(--tweak-bg-overlay)' }} />
      {/* Left-edge scrim — keeps headline and subhead legible over the bright
          warm parts of the footage without boxing the text in a pill. */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, rgba(4,8,15,0.72) 0%, rgba(4,8,15,0.38) 42%, rgba(4,8,15,0.08) 68%, rgba(4,8,15,0.30) 100%)' }}
      />

      {/* Navbar (Custom to Hero) */}
      <div className="relative z-10 w-full px-6 md:px-12 lg:px-16 pt-6">

        {/* Nav pill */}
        <nav className="liquid-glass rounded-xl px-4 py-2 flex items-center justify-between">
          {/* Logo — text-only to keep the glass pill clean */}
          <Link href="/" onClick={closeMenu} className="shrink-0 text-[22px] font-extrabold tracking-tight leading-none font-display">
            <span className="text-white">Bid</span><span style={{ color: '#10A7FF' }}>Wise</span>
          </Link>

          {/* Desktop center links */}
          <div className="hidden md:flex items-center gap-8 text-sm text-white">
            <Link href="/how-it-works" className="hover:text-gray-300 transition-colors">How It Works</Link>
            <Link href="/pricing" className="hover:text-gray-300 transition-colors">Pricing</Link>
            <Link href="/resources" className="hover:text-gray-300 transition-colors">Resources</Link>
            <Link href="/faq" className="hover:text-gray-300 transition-colors">FAQ</Link>
          </div>

          {/* Desktop right CTAs */}
          <div className="hidden md:flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/signup" className="btn-primary px-6 py-2 text-sm">
              Start Free Trial
            </Link>
          </div>

          {/* Mobile right — Sign In + hamburger */}
          <div className="md:hidden flex items-center gap-1">
            <Link
              href="/login"
              onClick={closeMenu}
              className="px-3 py-2 text-sm font-semibold text-gray-300 hover:text-white transition-colors touch-manipulation"
            >
              Sign In
            </Link>
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="p-2.5 text-white hover:text-gray-300 transition-colors rounded-lg hover:bg-white/10 active:bg-white/15 touch-manipulation"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </nav>

        {/* Mobile dropdown drawer */}
        {menuOpen && (
          <div className="md:hidden mt-2 liquid-glass rounded-xl overflow-hidden animate-slide-down">
            <div className="px-3 py-3 space-y-0.5">
              {[
                { label: 'How It Works', href: '/how-it-works' },
                { label: 'Pricing',      href: '/pricing' },
                { label: 'Resources',    href: '/resources' },
                { label: 'FAQ',          href: '/faq' },
              ].map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={closeMenu}
                  className="flex items-center px-4 py-4 text-[15px] font-medium text-gray-200 hover:text-white hover:bg-white/8 active:bg-white/12 rounded-xl transition-all touch-manipulation"
                >
                  {l.label}
                </Link>
              ))}

              <div className="pt-3 pb-1 space-y-2.5 border-t border-white/10 mt-1">
                <Link
                  href="/login"
                  onClick={closeMenu}
                  className="flex items-center justify-center w-full py-3.5 text-sm font-semibold text-gray-200 hover:text-white border border-white/25 rounded-xl hover:bg-white/8 active:scale-[0.98] touch-manipulation transition-all"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  onClick={closeMenu}
                  className="btn-primary flex items-center justify-center w-full py-3.5 text-sm active:scale-[0.98] touch-manipulation"
                >
                  Start Free Trial
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Backdrop — closes drawer on tap outside */}
        {menuOpen && (
          <div
            className="md:hidden fixed inset-0 top-0 z-[-1]"
            onClick={closeMenu}
          />
        )}
      </div>

      {/* Hero Content — vertically centered in the space below the nav so the
          first paint isn't a viewport of empty sky with text pinned to the fold. */}
      <div className="relative z-10 flex-1 flex flex-col justify-center px-6 md:px-12 lg:px-16 py-10 pointer-events-none" style={{ paddingBottom: 'var(--tweak-hero-pb)' }}>
        <div ref={contentRef} className="lg:grid lg:grid-cols-2 lg:items-center gap-12 pointer-events-auto">

          {/* Left Column */}
          <div>
            <AnimatedHeading key={tweaks.charDelay} text={"Know your number\nbefore you bid."} charDelay={tweaks.charDelay} />

            <FadeIn delay={450} duration={700}>
              <p className="text-base md:text-lg text-slate-200 mb-7 max-w-xl" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.85)' }}>
                Auction property analysis for serious investors. Comps, deal scoring, and your max bid — delivered in under 5 minutes.
              </p>
            </FadeIn>

            <FadeIn delay={650} duration={700} className="flex flex-wrap items-center gap-4 mt-2">
              <Link ref={ctaRef} href="/signup" className="btn-primary inline-flex items-center px-8 py-3.5 text-base" style={{ boxShadow: 'var(--tweak-cta-glow)' }}>
                Start Free Trial
              </Link>
              <Link href="#how-it-works" className="btn-secondary inline-flex items-center px-6 py-3.5 text-base backdrop-blur-sm">
                See how it works
              </Link>
            </FadeIn>

            <FadeIn delay={850} duration={700}>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 mt-7 text-[13px] font-medium text-slate-300" style={{ textShadow: '0 1px 10px rgba(0,0,0,0.85)' }}>
                {[
                  'DeKalb · Gwinnett · Clayton · Cobb counties',
                  'Every listing scored before auction day',
                  `${TRIAL_LABEL} free trial`,
                ].map(item => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check size={13} style={{ color: '#2DE2FF' }} className="shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>

          {/* Right Column — Mini Analysis Card */}
          <FadeIn delay={850} duration={800} className="flex items-end justify-start lg:justify-end mt-8 lg:mt-0">
            <div
              className="w-full max-w-[300px] rounded-2xl overflow-hidden origin-bottom-right"
              style={{ background: `rgba(8,13,26,var(--tweak-glass-opacity))`, backdropFilter: `blur(var(--tweak-glass-blur))`, border: `1px solid rgba(255,255,255,var(--tweak-border-opacity))`, boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(16,167,255,0.10)', transform: 'scale(var(--tweak-card-scale))' }}
            >
              {/* Card header */}
              <div className="px-4 py-3 border-b border-white/8 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10.5px] font-bold text-white leading-snug truncate">2847 Dunwoody Ln NE</div>
                  <div className="text-[9.5px] text-slate-500 mt-0.5">Atlanta, GA 30338 · SFR · 3bd/2ba</div>
                </div>
                {/* Score ring */}
                <div className="shrink-0 flex flex-col items-center">
                  <div className="w-[42px] h-[42px] rounded-full flex items-center justify-center"
                    style={{ background: 'conic-gradient(#10A7FF 0% 91%, rgba(16,167,255,0.15) 91% 100%)', padding: '2px' }}>
                    <div className="w-full h-full rounded-full bg-[#080d1a] flex items-center justify-center">
                      <span className="text-[13px] font-black" style={{ color: '#10A7FF' }}>91</span>
                    </div>
                  </div>
                  <div className="text-[8px] text-slate-500 mt-0.5 font-semibold uppercase tracking-wide">Score</div>
                </div>
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 divide-x divide-white/6 border-b border-white/6">
                {[
                  { label: 'Max Bid', value: '$34,500', color: 'text-white' },
                  { label: 'ARV',     value: '$198K',   color: 'text-white' },
                  { label: 'ROI',     value: '+248%',   brandColor: '#10A7FF' },
                ].map(m => (
                  <div key={m.label} className="px-3 py-2.5 text-center">
                    <div className="text-[8.5px] text-slate-500 uppercase tracking-wider font-bold mb-0.5">{m.label}</div>
                    <div className={`text-[13px] font-black ${m.color ?? ''}`} style={m.brandColor ? { color: m.brandColor } : {}}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#10A7FF' }} />
                  <span className="text-[9.5px] text-slate-400">4 comps · High confidence</span>
                </div>
                <span className="text-[9px] font-bold rounded-full px-2 py-0.5 border" style={{ color: '#10A7FF', background: 'rgba(16,167,255,0.10)', borderColor: 'rgba(16,167,255,0.22)' }}>
                  BID ✓
                </span>
              </div>

              {/* Mini comp list */}
              <div className="px-4 pb-3 space-y-1">
                {[
                  { addr: '2901 Henderson Rd', price: '$192K', dist: '0.3 mi' },
                  { addr: '3102 Dunwoody Club Dr', price: '$204K', dist: '0.5 mi' },
                ].map(c => (
                  <div key={c.addr} className="flex items-center justify-between py-1 border-t border-white/4">
                    <span className="text-[8.5px] text-slate-500 truncate max-w-[160px]">{c.addr} · {c.dist}</span>
                    <span className="text-[8.5px] font-bold text-slate-300 shrink-0 ml-2">{c.price}</span>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>

        </div>
      </div>
    </section>
  )
}
