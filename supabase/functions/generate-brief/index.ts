// supabase/functions/generate-brief/index.ts
//
// Real AI investment brief generator (Gemini). Invoked ON DEMAND ONLY by mobile
// AND web via supabase.functions.invoke('generate-brief', { body }). There is NO
// cron / scheduled invocation of this function — it costs money only when a user
// taps "Generate brief".
//
// Cost controls (so spend can never run away unnoticed):
//   • JWT-required + entitlement gate (active sub / trial) — no anonymous spend.
//   • app_config.ai_briefs_enabled — instant kill switch (set FALSE to stop all
//     spend immediately, no redeploy).
//   • per-user + global daily caps (app_config.ai_brief_user_daily_cap /
//     ai_brief_daily_cap) enforced BEFORE the paid call.
//   • bounded input (32KB) and output (MAX_OUTPUT_TOKENS) per call.
//   • every call's token usage is logged to console AND written to
//     ai_usage_events, and returned to the caller — so usage is always visible
//     (query ai_usage_events / ai_usage_summary, or the Supabase function logs,
//     or Google AI Studio for authoritative billing).
//
// Model from GEMINI_MODEL (default gemini-2.5-flash — cheap flash tier). The
// GEMINI_API_KEY secret is required; never hardcoded.

// @ts-expect-error Deno std import (resolved at deploy time, not in tsconfig)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-expect-error Supabase client (resolved at deploy time)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

// @ts-expect-error Deno global (resolved at deploy time)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
// @ts-expect-error Deno global
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
// @ts-expect-error Deno global
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// @ts-expect-error Deno global
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? ""
// Cheap flash tier by default. Bare model id; override via the GEMINI_MODEL secret.
// @ts-expect-error Deno global
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash"

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const MAX_OUTPUT_TOKENS = 1024
const REQUEST_TIMEOUT_MS = 45_000
// Reject oversized payloads before they ever reach the (paid) Gemini call.
const MAX_BODY_CHARS = 32_000

// Fallback caps if app_config can't be read (fail-safe to small numbers, never
// unbounded). The real caps live in app_config and can be tuned without deploy.
const DEFAULT_USER_DAILY_CAP = 25
const DEFAULT_GLOBAL_DAILY_CAP = 500

// CORS: the web app calls this from a browser; mobile uses native fetch (no
// Origin). Allow only known web origins (+localhost), overridable via
// GENERATE_BRIEF_ALLOWED_ORIGINS. The JWT is the real security boundary.
// @ts-expect-error Deno global (resolved at deploy time)
const ALLOWED_ORIGINS: string[] = (Deno.env.get("GENERATE_BRIEF_ALLOWED_ORIGINS") ??
  "https://bidwiseinvest.com,https://www.bidwiseinvest.com,http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? ""
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
}

function json(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  })
}

const SYSTEM_PROMPT =
  "You are a senior real-estate investment analyst writing for an experienced " +
  "tax-deed and off-market investor. Produce a concise, decision-useful brief " +
  "from the structured property data provided. Cover, in short labeled " +
  "sections: (1) Snapshot — what the property is; (2) The numbers — what the " +
  "figures imply (ARV, equity, tax/lien exposure, rehab, ROI) and any that look " +
  "off or missing; (3) Risks & red flags; (4) Bottom line — a clear, hedged " +
  "recommendation. Use only the data given; never invent specifics. If a value " +
  "is missing, say so rather than guessing. This is analysis, not legal or " +
  "investment advice. Plain text, no markdown headers, under ~350 words."

// Fixed instruction. NOT taken from the request body — a client-controlled
// instruction is a prompt-injection vector. Hardcoded so every brief is framed
// the same way.
const USER_INSTRUCTION = "Write the investment brief for the property/lead below."

function buildUserPrompt(payload: Record<string, unknown>): string {
  const data =
    (payload.property as unknown) ??
    (payload.lead as unknown) ??
    (() => {
      const clone: Record<string, unknown> = { ...payload }
      delete clone.instruction
      delete clone.model
      return clone
    })()
  const serialized = JSON.stringify(data, sortedReplacer, 2)
  return `${USER_INSTRUCTION}\n\nProperty / lead data (JSON):\n${serialized}`
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) out[k] = obj[k]
    return out
  }
  return value
}

interface GeminiResult {
  text: string
  promptTokens: number
  outputTokens: number
  totalTokens: number
}

async function callGemini(userPrompt: string): Promise<GeminiResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY, // key in header, not URL (stays out of logs)
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 },
      }),
    })

    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`gemini ${resp.status}: ${detail.slice(0, 500)}`)
    }

    const data = await resp.json()

    // Blocked prompt (safety) → no candidates / blockReason present.
    const blockReason = data?.promptFeedback?.blockReason
    if (blockReason) throw new Error(`gemini blocked: ${blockReason}`)

    const cand = data?.candidates?.[0]
    const text: string = (cand?.content?.parts ?? [])
      .map((p: { text?: string }) => p?.text ?? "")
      .join("")
      .trim()
    if (!text) {
      throw new Error(`gemini returned no text (finishReason=${cand?.finishReason ?? "?"})`)
    }

    const u = data?.usageMetadata ?? {}
    return {
      text,
      promptTokens: Number(u.promptTokenCount ?? 0),
      outputTokens: Number(u.candidatesTokenCount ?? 0),
      totalTokens: Number(u.totalTokenCount ?? 0),
    }
  } finally {
    clearTimeout(timer)
  }
}

// Active/trialing subscription OR non-expired cardless trial. Service-role
// client so the check can't be defeated by RLS quirks. Fails CLOSED.
async function isEntitled(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data: sub } = await admin
    .from("subscriptions").select("id")
    .eq("user_id", userId).in("status", ["active", "trialing"]).limit(1).maybeSingle()
  if (sub) return true
  const { data: trial } = await admin
    .from("user_trials").select("id")
    .eq("user_id", userId).gt("trial_ends_at", new Date().toISOString()).limit(1).maybeSingle()
  return Boolean(trial)
}

function startOfUtcDayISO(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, req)

  // ── 1. Verify caller JWT ─────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) return json({ error: "missing_authorization" }, 401, req)
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userErr } = await authClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401, req)
  const userId = userData.user.id

  // ── 2. Config check ──────────────────────────────────────────────────────
  if (!GEMINI_API_KEY) return json({ error: "ai_not_configured" }, 503, req)
  if (!SUPABASE_SERVICE_ROLE_KEY) return json({ error: "ai_not_configured" }, 503, req)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // ── 3. Kill switch + daily caps (read BEFORE any paid work) ──────────────
  const { data: cfg } = await admin
    .from("app_config")
    .select("ai_briefs_enabled, ai_brief_daily_cap, ai_brief_user_daily_cap")
    .eq("id", 1)
    .maybeSingle()
  if (cfg && cfg.ai_briefs_enabled === false) {
    return json({ error: "ai_disabled" }, 503, req)
  }
  const userCap = cfg?.ai_brief_user_daily_cap ?? DEFAULT_USER_DAILY_CAP
  const globalCap = cfg?.ai_brief_daily_cap ?? DEFAULT_GLOBAL_DAILY_CAP
  const since = startOfUtcDayISO()

  const { count: userToday } = await admin
    .from("ai_usage_events").select("*", { count: "exact", head: true })
    .eq("user_id", userId).gte("created_at", since)
  if ((userToday ?? 0) >= userCap) {
    return json({ error: "user_daily_limit", limit: userCap, used: userToday ?? 0 }, 429, req)
  }

  const { count: globalToday } = await admin
    .from("ai_usage_events").select("*", { count: "exact", head: true })
    .gte("created_at", since)
  if ((globalToday ?? 0) >= globalCap) {
    return json({ error: "daily_cap_reached", limit: globalCap }, 503, req)
  }

  // ── 4. Entitlement gate ──────────────────────────────────────────────────
  if (!(await isEntitled(admin, userId))) {
    return json({ error: "subscription_required" }, 403, req)
  }

  // ── 5. Read + size-limit body BEFORE the paid call ───────────────────────
  const raw = await req.text()
  if (raw.length > MAX_BODY_CHARS) {
    return json({ error: "payload_too_large", limit: MAX_BODY_CHARS }, 413, req)
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: "invalid_json_body" }, 400, req)
  }
  if (!payload || typeof payload !== "object") return json({ error: "invalid_body" }, 400, req)

  // ── 6. Generate (the only paid step) ─────────────────────────────────────
  try {
    const result = await callGemini(buildUserPrompt(payload))

    // Record usage: console (Supabase function logs) + durable ledger.
    console.log(JSON.stringify({
      evt: "generate_brief_usage", user: userId, model: GEMINI_MODEL,
      prompt_tokens: result.promptTokens, output_tokens: result.outputTokens,
      total_tokens: result.totalTokens,
    }))
    // Insert is best-effort: a logging failure must not fail the user's brief.
    const { error: logErr } = await admin.from("ai_usage_events").insert({
      user_id: userId, fn: "generate_brief", model: GEMINI_MODEL,
      prompt_tokens: result.promptTokens, output_tokens: result.outputTokens,
      total_tokens: result.totalTokens,
    })
    if (logErr) console.error("ai_usage_events insert failed:", logErr.message)

    return json({
      brief: result.text,
      usage: {
        model: GEMINI_MODEL,
        prompt_tokens: result.promptTokens,
        output_tokens: result.outputTokens,
        total_tokens: result.totalTokens,
      },
    }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isTimeout = e instanceof DOMException && e.name === "AbortError"
    return json(
      { error: isTimeout ? "ai_timeout" : "ai_error", detail: msg },
      isTimeout ? 504 : 502,
      req,
    )
  }
})
