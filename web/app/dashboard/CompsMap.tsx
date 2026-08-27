'use client'

import { useEffect, useRef, useState } from 'react'
import type { CompItem } from './PropertyDetailPanel'

// Zillow-style comps map (founder request 2026-07-05): interactive Google Map
// with the auction listing pin + numbered comp pins matching the comp cards.
// Loads the Maps JS API on mount, keyed by NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
// (a referrer-restricted browser key — NOT the server geocoding key). Renders
// nothing when the key or coordinates are missing, so older datasets and
// locked rows degrade silently. Parents gate on plan tier / unlock state.

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY

declare global {
  interface Window {
    google?: typeof google
    __bwMapsLoading?: Promise<void>
  }
}

function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined' || !MAPS_KEY) return Promise.reject(new Error('no key'))
  if (window.google?.maps) return Promise.resolve()
  if (!window.__bwMapsLoading) {
    window.__bwMapsLoading = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly`
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Google Maps failed to load'))
      document.head.appendChild(s)
    })
  }
  return window.__bwMapsLoading
}

// Circular numbered pin as an inline SVG data URI (emerald = top-5, slate = other).
function pinIcon(n: number, top5: boolean): string {
  const fill = top5 ? '%2310b981' : '%2394a3b8'
  return (
    `data:image/svg+xml;charset=UTF-8,` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">` +
    `<circle cx="13" cy="13" r="11" fill="${fill}" stroke="white" stroke-width="2.5"/>` +
    `<text x="13" y="17.5" font-family="Arial" font-size="11" font-weight="bold" fill="white" text-anchor="middle">${n}</text>` +
    `</svg>`
  )
}

// Subject pin: larger blue house marker.
const SUBJECT_ICON =
  `data:image/svg+xml;charset=UTF-8,` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">` +
  `<circle cx="17" cy="17" r="14" fill="%232563eb" stroke="white" stroke-width="3"/>` +
  `<path d="M17 9.5l-7 6h2v7h4v-4.5h2V22.5h4v-7h2z" fill="white"/>` +
  `</svg>`

interface CompsMapProps {
  subject: { lat: number; lng: number; address: string } | null
  comps: CompItem[]
}

export default function CompsMap({ subject, comps }: CompsMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  const pins = comps
    .map((c, i) => ({ n: i + 1, lat: c.lat, lng: c.lng, top5: !!c.top5, addr: c.a, price: c.p }))
    .filter((p): p is typeof p & { lat: number; lng: number } => p.lat != null && p.lng != null)

  const renderable = !!MAPS_KEY && (subject != null || pins.length >= 2)

  useEffect(() => {
    if (!renderable || !mapRef.current) return
    let cancelled = false

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapRef.current || !window.google) return
        const g = window.google.maps
        const map = new g.Map(mapRef.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'cooperative', // ctrl+scroll to zoom, like Zillow
          clickableIcons: false,
        })
        const bounds = new g.LatLngBounds()
        const info = new g.InfoWindow()

        if (subject) {
          const m = new g.Marker({
            map,
            position: subject,
            icon: { url: SUBJECT_ICON, scaledSize: new g.Size(34, 34), anchor: new g.Point(17, 17) },
            title: subject.address,
            zIndex: 100,
          })
          m.addListener('click', () => {
            info.setContent(`<div style="font:600 12px system-ui">${subject.address}<br/><span style="color:#2563eb">Auction listing</span></div>`)
            info.open({ map, anchor: m })
          })
          bounds.extend(subject)
        }

        for (const p of pins) {
          const m = new g.Marker({
            map,
            position: { lat: p.lat, lng: p.lng },
            icon: { url: pinIcon(p.n, p.top5), scaledSize: new g.Size(26, 26), anchor: new g.Point(13, 13) },
            title: `#${p.n} ${p.addr}`,
          })
          m.addListener('click', () => {
            const price = p.price >= 1000 ? '$' + Math.round(p.price / 1000) + 'K' : '$' + p.price
            info.setContent(`<div style="font:600 12px system-ui">#${p.n} ${p.addr}<br/><span style="color:#059669">Sold ${price}${p.top5 ? ' · top-5 comp' : ''}</span></div>`)
            info.open({ map, anchor: m })
          })
          bounds.extend({ lat: p.lat, lng: p.lng })
        }

        map.fitBounds(bounds, 40)
        g.event.addListenerOnce(map, 'idle', () => {
          if ((map.getZoom() ?? 0) > 15) map.setZoom(15)
        })
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pins derive from comps; subject identity is stable per panel open
  }, [renderable, subject?.lat, subject?.lng, comps])

  if (!renderable || failed) return null

  return (
    <div className="mb-2">
      <div
        ref={mapRef}
        className="w-full h-52 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden bg-slate-100 dark:bg-navy-700"
        aria-label="Map of the auction property and comparable sales"
      />
      <div className="flex items-center gap-3 mt-1.5 px-1">
        <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> This property
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Top-5 comp
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> Other comp
        </span>
        <span className="ml-auto text-[9px] text-slate-400 dark:text-slate-500">Ctrl + scroll to zoom</span>
      </div>
    </div>
  )
}
