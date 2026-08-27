// Canonical-URL regression guards (Cycle 7). Two bug classes shipped to prod
// and were caught live on 2026-07-14:
//   1. Apex-host canonicals — `https://bidwiseinvest.com/...` (no www) points
//      into the apex→www redirect, a duplicate-content signal. Seven pages
//      had it.
//   2. Layout-canonical inheritance — a canonical set in app/layout.tsx is
//      inherited by every page that doesn't override it, marking /pricing,
//      /signup, and /login as homepage duplicates.
// These tests scan the app/ SOURCE TREE so any new page that reintroduces
// either class fails CI before it can deploy.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SITE_URL } from '@/lib/site'

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = join(WEB_DIR, 'app')

// Matches the apex host ONLY — `https://bidwiseinvest.com` never carries the
// `www.` prefix, so a plain literal match is exact.
const APEX_RE = /https:\/\/bidwiseinvest\.com/

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe('site origin', () => {
  it('SITE_URL is the www host', () => {
    expect(SITE_URL).toBe('https://www.bidwiseinvest.com')
  })
})

describe('no apex-host URLs anywhere under app/', () => {
  it('every bidwiseinvest.com literal uses the www host', () => {
    const offenders = collectSourceFiles(APP_DIR)
      .filter(f => APEX_RE.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(WEB_DIR.length + 1))
    expect(offenders).toEqual([])
  })
})

describe('layout-canonical inheritance guard', () => {
  it('root layout sets NO alternates/canonical (pages own their canonicals)', () => {
    const rootLayout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
    expect(rootLayout).not.toMatch(/alternates\s*:/)
  })

  it.each(['pricing', 'signup', 'login'])(
    '%s has a metadata route layout with a self-canonical (its page is a client component)',
    route => {
      const layout = readFileSync(join(APP_DIR, route, 'layout.tsx'), 'utf8')
      expect(layout).toMatch(/canonical:\s*`\$\{SITE_URL\}\//)
    },
  )

  it('login is noindexed and stays out of the sitemap', () => {
    const loginLayout = readFileSync(join(APP_DIR, 'login', 'layout.tsx'), 'utf8')
    expect(loginLayout).toMatch(/index:\s*false/)
    const sitemap = readFileSync(join(APP_DIR, 'sitemap.ts'), 'utf8')
    expect(sitemap).not.toMatch(/\$\{SITE_URL\}\/login/)
  })
})
