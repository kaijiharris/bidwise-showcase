import path from 'path'
import { fileURLToPath } from 'url'
import { SECURITY_HEADERS } from './lib/security-headers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
  },
  // Baseline security headers on every route. Definitions live in
  // lib/security-headers.mjs (single tested source of truth). No CSP yet —
  // deferred to a report-only pass (see that module's note).
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
  // The paid datasets moved out of public/ into web/data/ and are read at
  // runtime via fs in the /api/data route handlers (web/lib/county-data.ts).
  // Next's output file tracer cannot detect dynamic fs reads, so without this
  // the JSON is NOT bundled into the Vercel serverless functions — every
  // /api/data request 500s (ENOENT) in production while working in `next dev`.
  // Force-include the data dir for those route handlers.
  outputFileTracingIncludes: {
    '/api/data/[county]': ['./data/**'],
    '/api/data/[county]/auctions': ['./data/**'],
    // /free-list/[county] is force-dynamic and fs-reads the same datasets via
    // lib/county-data — same ENOENT trap as above without this include.
    '/free-list/[county]': ['./data/**'],
  },
  webpack(config) {
    config.resolve.alias['@'] = path.resolve(__dirname)
    return config
  },
}

export default nextConfig
