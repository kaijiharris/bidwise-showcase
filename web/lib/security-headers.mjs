// Baseline HTTP security headers applied to every response via next.config.mjs
// `headers()`. Kept in a standalone .mjs module (importable by both the Next
// config and vitest) so the header set is a single, tested source of truth
// rather than an inline literal that can silently drift from its test.
//
// Deliberately NO Content-Security-Policy in this pass: a nonce/allowlist CSP
// interacts with GSAP, PostHog, Sentry, and Next's inline bootstrap, so it needs
// report-only tuning before enforcement (tracked as a follow-up). HSTS is already
// applied at the Vercel platform edge, so it is not duplicated here.

/** @typedef {{ key: string, value: string }} SecurityHeader */

/** @type {ReadonlyArray<SecurityHeader>} */
export const SECURITY_HEADERS = [
  // Stop MIME-type sniffing (a content-confusion / stored-XSS vector).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Disallow framing entirely — clickjacking defense on a payments-bearing app.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Send origin only (not full URL) on cross-origin navigation.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deny powerful browser features the app never uses.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
