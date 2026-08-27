import { describe, it, expect } from 'vitest'
import { SECURITY_HEADERS } from '@/lib/security-headers.mjs'
import nextConfig from '../next.config.mjs'

type Header = { key: string; value: string }

// A lookup for asserting individual header values without depending on order.
function headerMap(headers: Header[]): Record<string, string> {
  return Object.fromEntries(headers.map(h => [h.key, h.value]))
}

describe('SECURITY_HEADERS — baseline hardening (no CSP in this PR)', () => {
  const map = headerMap(SECURITY_HEADERS as Header[])

  it('sets X-Content-Type-Options to nosniff', () => {
    expect(map['X-Content-Type-Options']).toBe('nosniff')
  })

  it('sets X-Frame-Options to DENY (clickjacking defense)', () => {
    expect(map['X-Frame-Options']).toBe('DENY')
  })

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('locks down camera, microphone, and geolocation via Permissions-Policy', () => {
    expect(map['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
  })

  it('does NOT ship a Content-Security-Policy in this PR (deferred as too risky pre-demo)', () => {
    expect(map['Content-Security-Policy']).toBeUndefined()
  })

  it('every header entry is a non-empty {key, value} pair', () => {
    for (const h of SECURITY_HEADERS as Header[]) {
      expect(typeof h.key).toBe('string')
      expect(h.key.length).toBeGreaterThan(0)
      expect(typeof h.value).toBe('string')
      expect(h.value.length).toBeGreaterThan(0)
    }
  })
})

describe('next.config.mjs headers() — wired to the shared source of truth', () => {
  it('applies the baseline set to every route via a catch-all source', async () => {
    // Assert the REAL config output, so the header set cannot drift from its test.
    expect(nextConfig.headers).toBeTypeOf('function')
    const entries = await nextConfig.headers!()
    expect(Array.isArray(entries)).toBe(true)
    expect(entries).toHaveLength(1)
    const [rule] = entries
    expect(rule.source).toBe('/:path*')
    // Same array instance the shared module exports — impossible to drift.
    expect(rule.headers).toBe(SECURITY_HEADERS)
  })
})
