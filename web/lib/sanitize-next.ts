// Shared post-auth redirect sanitizer.
//
// Open-redirect via `?next=` is the threat model: a phishing link such as
// /login?next=//attacker.example or /auth/callback?next=https://evil.test
// would otherwise bounce the user to an attacker page after a successful
// login. Only same-origin paths on a tight allowlist are permitted; anything
// else returns null so callers fall back to their default landing route.

// Tight allowlist of post-auth landing routes.
const ALLOWED_NEXT_PATHS = new Set<string>(['/reset-password', '/dashboard', '/settings'])
const ALLOWED_NEXT_PREFIXES = ['/dashboard/', '/settings/']

/**
 * Validate a caller-supplied `next` redirect target.
 *
 * Returns the original value only when it is a same-origin path that matches
 * the allowlist; otherwise returns null.
 *
 * Rejected: protocol-relative (`//host`), absolute URLs (anything with `:`),
 * non-`/`-prefixed values, and any path not on the allowlist.
 */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Must be a single-slash absolute path. Reject protocol-relative `//host`.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // Reject anything containing a scheme separator (e.g. `/\evil`, `javascript:`,
  // or a backslash that some browsers normalize to `/`).
  if (raw.includes(':') || raw.includes('\\')) return null

  const pathOnly = raw.split(/[?#]/)[0]
  if (ALLOWED_NEXT_PATHS.has(pathOnly)) return raw
  if (ALLOWED_NEXT_PREFIXES.some((p) => pathOnly.startsWith(p))) return raw
  return null
}
