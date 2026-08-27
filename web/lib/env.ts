// Server-side env validation. Imported from app/layout.tsx so a missing
// required var crashes the server at boot instead of letting `!` non-null
// assertions silently produce `"undefined"` strings deep in request handlers.
//
// IMPORTANT: do NOT import this file from any client component or any module
// that is reachable from one. Bundling NEXT_PUBLIC_* into the client is fine;
// bundling references to server-only secrets (STRIPE_SECRET_KEY, service role)
// is not. Server-only validation stays here.

const REQUIRED_SERVER = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_STARTER_MONTHLY',
  'STRIPE_STARTER_ANNUAL',
  'STRIPE_PRO_MONTHLY',
  'STRIPE_PRO_ANNUAL',
  'STRIPE_EXPERT_MONTHLY',
  'STRIPE_EXPERT_ANNUAL',
] as const

const REQUIRED_PUBLIC = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_URL',
] as const

// Optional: rate limiting via Vercel KV. When unset, lib/rate-limit.ts is a
// no-op and /api/stripe/checkout has no per-user throttle. Provision the KV
// store in Vercel → Storage → KV and the env vars get injected automatically.
//   KV_REST_API_URL
//   KV_REST_API_TOKEN
//   KV_REST_API_READ_ONLY_TOKEN  (unused server-side; KV provisions it)

const missing: string[] = []
for (const k of [...REQUIRED_SERVER, ...REQUIRED_PUBLIC]) {
  if (!process.env[k] || process.env[k]!.length === 0) missing.push(k)
}

if (missing.length > 0) {
  throw new Error(
    `[env] Missing required environment variables: ${missing.join(', ')}. ` +
    `Set them in web/.env.local for dev or in Vercel project settings for prod.`,
  )
}

export const env = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL!,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? '',
} as const
