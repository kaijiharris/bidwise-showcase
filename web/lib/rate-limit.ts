import { kv } from '@vercel/kv'

// Fixed-window counter. Sufficient for protecting Stripe checkout from
// scripted abuse — sliding window would be slightly fairer but adds a second
// round-trip per check. Stripe's own per-key rate limits sit ~100 req/s so
// we just need to keep individual users well below that ceiling.
const WINDOW_SECONDS = 60
const MAX_PER_WINDOW = 5

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

export async function checkRateLimit(
  key: string,
  windowSeconds?: number,
  maxPerWindow?: number,
): Promise<RateLimitResult> {
  // Dev environments and pre-provisioning prod won't have KV credentials.
  // Returning `ok: true` here means rate limiting is a deploy-time switch
  // (set the env vars in Vercel → KV is live) rather than a code release.
  if (!kvConfigured()) return { ok: true }

  const bucket = `ratelimit:${key}`
  const window = windowSeconds ?? WINDOW_SECONDS
  const max = maxPerWindow ?? MAX_PER_WINDOW

  try {
    const count = await kv.incr(bucket)
    if (count === 1) {
      await kv.expire(bucket, window)
    }
    if (count > max) {
      const ttl = await kv.ttl(bucket)
      return {
        ok: false,
        retryAfterSeconds: ttl > 0 ? ttl : window,
      }
    }
    return { ok: true }
  } catch (err) {
    // Fail open. If KV is down, blocking paying customers from upgrading is
    // worse than the brief loss of rate limiting. The log line is the signal
    // for alerting/oncall.
    console.error('[rate-limit] KV check failed for', key, err)
    return { ok: true }
  }
}
