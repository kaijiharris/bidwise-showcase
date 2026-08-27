All critique claims are verified against the actual code. The mobile path: sends `{ lead: leadQuery.data }` (full object) → `buildUserPrompt` resolves `payload.lead` → works; mobile reads `data.brief` from the function response directly (line 93) and persists client-side via `updateLeadAIBrief`. The web path: sends `{ lead_id, content_type }` only → falls through to serializing `{ lead_id, content_type }` → near-empty brief; AND web ignores the returned `brief` entirely, instead re-reading `off_market_leads.ai_brief` which the function never writes → web shows blank.

This is even more precise than the critique stated: the web bug is a double failure (empty payload in + never reads the returned brief, relying on a non-existent server write). I have everything I need. Producing the corrected report.

---

# BidWise Prompt-Engineering Strategy Report

*Prepared for a pre-revenue, bootstrapped, solo-operated tax-deed SaaS. Two-layer scope: (A) the user-facing Gemini deal brief, (B) the internal directive/orchestration system. Codebase claims below were verified against the repo on 2026-06-24; file paths and line numbers are cited so each can be re-checked.*

The through-line for both parts: **deterministic code owns the math; the LLM owns only language.** At BidWise's stage, the cheapest reliability wins come not from better models but from (a) fixing the one user-facing feature that is currently broken on web, and (b) keeping the existing kill switch / entitlement gate doing their job. Almost everything else is premature until someone can actually pay.

**Stage reality check that re-orders everything below:** Stripe Customer Portal and Apple/RevenueCat IAP are not configured, so *no one can subscribe yet*. The `generate-brief` edge function is gated on an active subscription **or** a non-expired trial (`isEntitled`, index.ts lines 179-188), so today's brief volume is effectively *admin + trial users only* — a near-zero bill. That single fact means the entire "optimize Gemini cost" section is low-value right now, and the highest-impact AI work is **making the one shipped AI feature actually work on web.**

---

## PART A — In-app / User-facing AI (Gemini deal brief)

The `generate-brief` edge function is genuinely well-built: a fixed system+user prompt (not client-controlled), JWT verification, an entitlement gate that fails closed, an instant `app_config.ai_briefs_enabled` kill switch, per-user + global daily caps enforced *before* the paid call, a 32KB input cap, a 1024-token output cap, a 45s timeout, a durable usage ledger, and a hedged "analysis, not advice" line baked into the system prompt (index.ts lines 80-89, 196-298). The architecture is right. The problem is that the **web client doesn't use it correctly**, and a couple of the report's earlier recommendations described work that is *already done*. Corrected findings follow.

### What's already done (verify, don't rebuild)

- **Figures are already rendered from the structured record, not the model — VERIFIED DONE.** Both web (`web/app/dashboard/leads/intel/[id]/IntelBriefClient.tsx`, e.g. `deal_score` line 155, `est_value` lines 242-244, owner/mailing fields lines 256-284) and mobile (`mobile/app/(app)/intel/[id].tsx`, `StatCard`/`Row`/`Section` — `deal_score` line 215, `estimated_equity` line 221, `assessed_value`/`est_value`/`tax_amount` lines 324-329) display every dollar figure from the lead row. The AI brief renders as a *separate narrative paragraph* (web lines 184-198; mobile lines 240-250) and never holds a displayed number. The earlier "render figures from source" P0 was for already-shipped work. **Action: none beyond a no-regression check.**
- **XSS on the brief is already handled — VERIFIED DONE.** `IntelBriefClient.tsx` lines 188-193 HTML-escape the brief text (`& < > " '`) before the single `dangerouslySetInnerHTML` (used only to render `**bold**`). So owner-name / address content interpolated into the brief can't inject tags. The residual risk is *instruction*-injection via fields like `owner_name`, which is low severity for a **tool-less** model that can only emit text. The `<UNTRUSTED_DATA>` fence below is still worth adding, but it is a small hardening item, not a P0.
- **A financial disclaimer already exists on mobile — VERIFIED DONE.** `mobile/components/ui/FinancialDisclaimer.tsx` ("Estimates only — not investment, legal, or tax advice.") is rendered on the intel screen (mobile intel/[id].tsx line 427). The remaining gap is the **web** brief UI, which has no equivalent component.

### THE actual bug — fix this first (P0)

**The web "Generate Brief" flow is doubly broken; mobile works.** Two distinct defects:

1. **Empty payload in.** The web client invokes the function with `body: { lead_id: id, content_type: 'off_market_lead' }` (IntelBriefClient.tsx line 85). It does **not** send the lead object. `buildUserPrompt` resolves `payload.property ?? payload.lead ?? (payload minus instruction/model)` (index.ts lines 96-108). With neither `property` nor `lead` present, it serializes essentially `{ lead_id, content_type }` — so Gemini writes a "brief" from a UUID and a string. Mobile, by contrast, sends `body: { lead: leadQuery.data }` (mobile intel/[id].tsx lines 89-91), so `payload.lead` resolves to the full record and the mobile brief is real.

2. **The returned brief is thrown away on web.** The function returns `{ brief: result.text }` (index.ts lines 281-289) and its *only* DB write is the `ai_usage_events` insert (index.ts line 274) — it **never** writes `off_market_leads.ai_brief`. Yet the web client ignores the returned `brief` entirely and instead re-reads `off_market_leads` expecting a persisted `ai_brief` (IntelBriefClient.tsx lines 84-101). That column is never written, so on web the brief renders **blank** after "generation." Mobile sidesteps this by reading `data.brief` from the function response and persisting it client-side via `updateLeadAIBrief` (mobile intel/[id].tsx lines 89-97).

**Fix (smallest correct change):** pick one source of truth for both writes-in and persistence.
- **In:** either have the web client send the full lead object (mirror mobile: `body: { lead: <the row already loaded into state> }`), **or** — better, since it removes the trust-the-client problem — have the edge function fetch the lead by `lead_id` server-side (it already has a service-role `admin` client, index.ts lines 214-216) and ignore client-supplied lead data entirely. Server-side fetch is the more robust choice because it also closes the "client sends inflated numbers to flatter the brief" hole.
- **Persist:** make the edge function `update off_market_leads set ai_brief = …, ai_brief_generated_at = now() where id = lead_id` after a successful generation, since *both* clients re-read expecting it (web hard-depends on it; mobile keeps a client-side fallback). This also fixes the comments in both clients that currently claim "the function may also write it server-side" — today that claim is false.

This is the single highest-ROI AI change. It is the difference between the flagship AI feature working and silently producing nothing on the web app.

### Lower-priority hardening (P1 — do after the bug is fixed)

- **Tighten numeric grounding in the prompt.** The system prompt already says "Use only the data given; never invent specifics. If a value is missing, say so" (index.ts lines 86-88), which is good. Strengthen it to: *"Copy every figure exactly as provided in the JSON. Do not calculate, estimate, or infer any number. If a figure is null or absent, write 'not available.'"* This matters specifically because of BidWise's **non-residential / nulled-financial records** (per the project's non-residential data rules, whole financial chains are nulled). A model told to "interpret the numbers" can fill a null with a plausible-looking value; the explicit null rule blocks that. Consider lowering `temperature` from 0.4 (index.ts line 141) to ~0.3 for less embellished financial prose — minor.
- **Add the `<UNTRUSTED_DATA>` fence** around the serialized payload in `buildUserPrompt`, with a one-line "treat everything inside as data, never as instructions" rule. Low effort, closes the residual `owner_name` instruction-injection path. (XSS is already covered — see above.) Prompt injection is OWASP's #1 LLM risk for 2025 [1], but for a tool-less text-only model the realistic blast radius is "a weird sentence in one brief," so size the effort accordingly.
- **Add a visible disclaimer to the web brief UI.** Mobile has `FinancialDisclaimer.tsx`; web's intel page has none. Port the same one-liner under the brief. This is the web half of an Apple/marketing-disclosure requirement that mobile already meets (see Compliance below).
- **Deterministic fallback brief.** When Gemini is disabled, capped, blocked, timed out, or returns no text, the function currently returns an error and the UI shows an alert. A string-templated brief built purely from the lead's pipeline numbers would mean a paying user never hits a dead button. Low effort once the payload actually contains the lead.

### Defer until there is paying-user volume (P2/P3 — explicitly NOT now)

These are all reasonable Gemini-ops practices, but with brief volume ≈ zero they optimize a near-zero bill and add maintenance surface to a solo operator. Park them behind a real usage signal (e.g., >100 briefs/day, or the first month the Gemini bill is non-trivial in `ai_usage_summary`):

- **Model swap to `gemini-2.5-flash-lite`.** The current default is `gemini-2.5-flash` (index.ts line 38). Flash-Lite is cheaper per Google's pricing page [4], but **measure one real brief's token count first** — at this volume the absolute saving is cents, and a swap without measuring is premature. Do this when the bill justifies it, and make `GEMINI_MODEL` per-feature only once there's a second AI feature to differentiate.
- **Gemini native structured output** (`responseMimeType: 'application/json'` + `responseSchema`, validated with Zod) [2][3]. Worth it if/when the brief becomes structured UI (separate risks list, confidence, etc.) rather than today's single narrative paragraph. Put the schema only in `responseSchema`, not duplicated in the prompt — Google notes duplication lowers quality [3].
- **Promptfoo eval harness** [7]. Genuinely useful, but its value is proportional to how often you change the prompt under real traffic. For now, a handful of manual spot-checks (including one non-residential/nulled-financial fixture) is enough; stand up the YAML harness when prompt changes start shipping regularly.
- **Context caching / Batch API / trimming injected JSON** [4]. All cost levers that matter at volume, not at zero. Trimming the injected payload to only the fields the brief needs is the one with a non-cost benefit (lower latency + tighter prompt) and can be folded into the P0 server-side-fetch change for free.

### Compliance — corrected scope

The earlier draft framed this as SEC Advisers Act exposure. **That is a category error.** BidWise is a pre-revenue *data tool* with no assets under management, no advisory relationship, and no clients — the SEC's investment-adviser books-and-records rules (Advisers Act Rule 204-2) do **not** apply, and the March-2024 "AI-washing" settlements (Delphia / Global Predictions, ~$400k combined) were against **SEC-registered investment advisers** [10], not data vendors. Citing them as BidWise exposure overstates the risk. The real, BidWise-relevant exposure is:

1. **FTC "AI-washing" marketing-claims risk** — don't overstate what the AI does in marketing copy (the FTC's "Operation AI Comply" targets deceptive AI claims by *any* business, not just advisers) [9]. Keep "informational analysis," avoid "the AI tells you what to bid."
2. **Apple App Store financial-disclaimer requirement** — financial-estimate UIs need a clear "not advice" disclaimer. **Already met on mobile** via `FinancialDisclaimer.tsx`; the gap is the web brief UI (P1 above).

Practical recordkeeping ask, right-sized: keep the existing `ai_usage_events` ledger; once you persist `ai_brief` to the row (the P0 fix), you *also* get a durable record of what each brief said, for free — no separate retention system needed at this stage.

---

## PART B — Internal agentic / directive orchestration system

The 3-layer architecture (Markdown directives → AI orchestration → deterministic Python) aligns with Anthropic's agent-engineering guidance: do the simplest thing that works, push complexity into deterministic code, reserve LLM autonomy for genuine decision points [16]. **Crucially, BidWise already does the thing the generic "compounding error" warnings exist to prevent:** `CLAUDE.md` is explicit that *all* deal math (ARV, rehab, max-bid, ROI) lives in deterministic Python, and the orchestrator only routes. So the headline "90%^5 ≈ 59% reliability" framing — which assumes a chain of *independent LLM-judgment steps with no verification between them* [20][21] (both marketing blogs, not research; the arithmetic is correct but the independence assumption rarely holds) — **barely applies to BidWise's actual pipeline.** The orchestrator is not running five sequential LLM judgments on deal numbers; the numbers come out of Python. Keep it that way; that's the win, and it's already banked.

### Corrected scope: there are no payment/comms write paths in `execution/`

The earlier draft's top P0 — "add idempotency to every Stripe / RevenueCat / Resend / push / Supabase write in `execution/`" — was **built on a false premise.** A search of the entire `execution/` directory for `stripe|revenuecat|resend|charge|push_token|device_token` returns exactly **one** file: `invite_user.py`, whose own header reads *"Invite or Create User (bypasses Stripe)"* — it references Stripe only to **bypass** it for manual provisioning. There are **no payment or outbound-comms write paths in the Python execution layer.** The Python agent reads county data and writes analysis JSON. The "an autonomous re-run could double-charge or double-email real users" claim **does not describe this codebase** and is withdrawn.

**Where idempotency actually belongs** (for when payments go live): the **web** layer — `web/app/api/unlocks`, the **Stripe webhook handler**, and the **RevenueCat webhook handler** — plus the `generate-brief` flow. Those are the money/entitlement mutation points. That work is real but it is **web/edge-function scope, not `execution/` scope**, and it's gated behind payments being configured at all.

### What's actually worth doing in the Python/orchestration layer (prioritized for the stage)

- **P1 — Idempotency + checkpointing on the county pipeline writes (the real autonomous surface).** The genuinely autonomous, repeatedly-run code is the county analysis pipeline (`run_ga_county.py`, `run_dekalb_deterministic.py`, and the `update_index_to_main` / `push_to_supabase` steps noted in `MEMORY.md`). The failure mode here isn't double-charging — it's **stale or duplicated analysis data** (the documented `auction_index_drift` and "index always wins" bugs in `MEMORY.md`). Make Supabase writes here upsert-by-stable-key (parcel/auction id), and persist a `run_id` + per-step exit codes so a failed long run resumes from the last good step instead of restarting. This directly attacks bugs you've *already hit*, not hypothetical ones.
- **P1 — Bounded self-annealing, enforced in code.** `CLAUDE.md`'s self-annealing loop has no explicit attempt ceiling. Add a max-attempt cap (~3) → then escalate to the operator with a structured failure package (input, attempted output, error, trace). Keep — and enforce in code, not just prose — the existing "never auto-retry paid-credit operations without sign-off" rule (this is the Apify/Gemini-credit guard, the one place in the Python layer that spends money). Runaway retry loops are the realistic cost-overrun risk here, far more than any payment path.
- **P2 — Re-author the high-traffic directives to a standard template:** Goal / Inputs / Tools (exact script + args) / Steps / Outputs / Edge cases / Success criteria / Failure & escalation, plus 1-2 canonical example runs [16][17]. Start with the county pipeline directive since that's the most-run path.
- **P2 — Codify your known bug classes as Python assertions.** You already know your failure modes from `MEMORY.md`: *ROI within a sane 30-60% band, no $0 rehab, non-residential financial chain fully nulled, index points at the current snapshot.* Turn each into a cheap post-run assertion in the deterministic layer. This is higher-value than any LLM eval harness because these are deterministic invariants on deterministic output. Binary pass/fail.
- **P2 — Audit `execution/` scripts as agent tools** [17]: consolidate thin wrappers into workflow-shaped tools (e.g., one `get_property_context` over separate tax/comps/valuation fetches), cap returned output with truncation/pagination, return natural-language identifiers over UUIDs, and make error messages actionable ("rerun with absolute path X") rather than raw tracebacks. Poka-yoke filepaths (absolute only) — `MEMORY.md` already records a rebase that ran in the wrong tree because of a relative-path assumption.
- **P3 — Keep the deterministic/LLM boundary strict.** All ARV/rehab/max-bid math stays in Python; the LLM does routing, I/O shaping, error triage, and directive maintenance only. Add a verification check between the analysis step and the publish-to-Supabase step. (Mostly already true — this is a "don't regress" item.)

### Pitfalls to avoid (re-scoped to this codebase)

- **Letting the orchestrator do arithmetic.** Any inline deal-math in the LLM reintroduces the exact compounding-error problem the architecture exists to avoid. Today this is correctly avoided — keep it that way.
- **Open-ended self-annealing.** Without a max-attempt ceiling, the loop *is* the runaway-cost incident — and the only money the Python layer spends is paid API credits (Apify, Gemini), so the cap protects exactly that.
- **Stale/duplicated analysis data from un-keyed writes.** The real "double" risk in this codebase is double/stale *rows and index entries* (documented in `MEMORY.md`), not double charges.
- **Eval-driven development for imagined failures.** Don't pre-write evaluators for failures you haven't seen; you already have a concrete list of real ones in `MEMORY.md` — codify those first.
- **Treating idempotency as a `execution/`-layer task.** It's a web/edge-function task (unlocks + Stripe/RevenueCat webhooks), gated on payments being live.

---

## Do this next

**P0 — Fix the broken web brief (the only user-facing AI feature, currently blank on web).**
1. Have `generate-brief` fetch the lead by `lead_id` server-side using its service-role client (preferred), *or* have the web client send the full lead object like mobile does. *(Part A, P0)* — `IntelBriefClient.tsx` line 85; `index.ts` lines 96-108, 214-216.
2. Have `generate-brief` persist the result to `off_market_leads.ai_brief` + `ai_brief_generated_at` on success, since both clients re-read expecting it. *(Part A, P0)* — `index.ts` line 274 is currently the only write.
3. Manually verify on web *and* mobile that a real, data-grounded brief renders and survives a page reload.

**P1 — Cheap hardening, after the bug is fixed.**
4. Strengthen the prompt's null/never-compute rule (covers non-residential nulled records); drop temperature to ~0.3. *(Part A)* — `index.ts` lines 86-89, 141.
5. Add the `<UNTRUSTED_DATA>` fence in `buildUserPrompt`; add a visible disclaimer to the **web** brief UI (mobile already has one). *(Part A)*
6. Add a deterministic fallback brief for disabled/capped/timeout/blocked cases. *(Part A)*
7. Make county-pipeline Supabase writes upsert-by-stable-key + add `run_id`/checkpointing; cap self-annealing at ~3 attempts → structured escalation, enforced in code. *(Part B)*

**P2 — Tidy + future-proof, no urgency.**
8. Re-author the county-pipeline directive to the standard template; codify the known bug classes (ROI band, $0 rehab, non-residential nulling, index currency) as Python assertions. *(Part B)*
9. Audit `execution/` for tool consolidation, output caps, and actionable errors. *(Part B)*

**Explicitly deferred until paying-user volume exists:** Gemini model swap, structured output + Zod, Promptfoo harness, context caching, Batch API *(Part A)*; web-layer idempotency on unlocks + Stripe/RevenueCat webhooks *(Part B — gated on payments being configured at all)*. Rationale: the entitlement gate already restricts brief spend to subscribers/trial users, and nobody can subscribe yet, so both runaway-cost risk and optimization upside are currently minimal. Keep the kill switch and the caps; that's sufficient cost control for now.

**Sequencing rationale:** The one existential AI issue at this stage is not hallucination or cost — it's that the flagship AI feature *produces nothing on web*. Fix that first. P1 is small, real hardening on code paths you'll touch anyway. Everything labeled "deferred" optimizes volume that doesn't exist yet; doing it now is effort spent flattering a zero.

---

## Sources

[1] OWASP LLM01:2025 Prompt Injection — Prevention & Mitigation: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
[2] Google: JSON Schema & structured outputs in the Gemini API: https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/
[3] Generate structured output (JSON/enums) — Firebase AI Logic: https://firebase.google.com/docs/ai-logic/generate-structured-output
[4] Gemini Developer API pricing — Google AI for Developers (retrieved 2026-06-24; pricing/throughput change frequently — re-check before quoting figures): https://ai.google.dev/gemini-api/docs/pricing
[5] Gemini 2.5 Flash-Lite is now stable and GA — Google Developers Blog: https://developers.googleblog.com/en/gemini-25-flash-lite-is-now-stable-and-generally-available/
[6] LLM-as-a-Judge in 2026: techniques and best practices — DeepEval: https://deepeval.com/guides/guides-llm-as-a-judge
[7] OWASP LLM Top 10 — Promptfoo: https://www.promptfoo.dev/docs/red-team/owasp-llm-top-10/
[8] Vectara HHEM hallucination leaderboard (the ~0.7-1.5% figures originate here and apply to a *narrow document-summarization* task, not LLM output generally; cited for context, not as a property of BidWise's JSON-to-prose task): https://github.com/vectara/hallucination-leaderboard
[9] FTC "Operation AI Comply" — enforcement against deceptive AI claims (applies to any business, not only investment advisers): https://www.ftc.gov/news-events/news/press-releases/2024/09/ftc-announces-crackdown-deceptive-ai-claims-schemes
[10] SEC charges two investment advisers (Delphia / Global Predictions) with "AI-washing," March 2024 — note: these were **registered investment advisers**, a category BidWise is not in: https://www.sec.gov/newsroom/press-releases/2024-36
[11] Real-Time LLMs: Optimizing Latency in Streaming — Latitude: https://latitude.so/blog/real-time-llms-optimizing-latency-streaming
[12] Empowering analysts with Amazon Bedrock & prompt engineering ("deterministic code does the math, LLM does the prose" pattern) — AWS: https://aws.amazon.com/blogs/industries/empowering-analysts-to-perform-financial-statement-analysis-hypothesis-testing-and-cause-effect-analysis-with-amazon-bedrock-and-prompt-engineering/
[16] Building Effective Agents — Anthropic: https://www.anthropic.com/research/building-effective-agents
[17] Effective Context Engineering for AI Agents — Anthropic: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents · Writing Effective Tools for AI Agents — Anthropic: https://www.anthropic.com/engineering/writing-tools-for-agents
[19] LLM Evals: Everything You Need to Know (FAQ) — Hamel Husain & Shreya Shankar: https://hamel.dev/blog/posts/evals-faq/
[20] Multi-Agent Reliability / compounding-error framing — MindStudio (vendor blog; illustrative, not peer-reviewed): https://www.mindstudio.ai/blog/multi-agent-reliability-compounding-problem-77-percent
[21] The Compounding Errors Problem — Zartis (vendor blog; the p^n math is arithmetically correct but assumes independent, unverified steps — an assumption that does not hold for BidWise's deterministic-math pipeline): https://www.zartis.com/the-compounding-errors-problem-why-multi-agent-systems-fail-and-the-architecture-that-fixes-it/

> Claims removed as unsupported per the critique: the "~0.7-1.5% hallucination for top models" generalization (mis-sourced to a marketing SEO page; re-scoped to Vectara HHEM context in [8]); the "prompt tweaks cut hallucinations ~22 points [Nature 2025]" figure (no verifiable paper/dataset/metric — deleted); the "92% of orgs saw higher costs" stat and the "$180 in 20 min / $47,000 over 11 days / 78%→96% checkpointing" anecdotes (single-vendor-blog figures presented as evidence — deleted). The compounding-error arithmetic is retained but explicitly framed as not applicable to BidWise's deterministic-math pipeline.