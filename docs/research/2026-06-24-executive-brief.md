I have everything I need. The three reports are detailed and self-consistent. Writing the executive brief now.

# BidWise — Executive Brief
*Chief of staff synthesis · 2026-06-24 · for the founder, Monday-morning ready*

---

## 1. The one-paragraph state of play

BidWise is a well-built, pre-revenue tax-deed SaaS that is **gated by config, not by code**: the product, brand foundation, paywall, security, and (mostly) the monetization rails already exist — but **nobody can pay yet** because Stripe Customer Portal is a ~10-minute Dashboard toggle that hasn't been flipped, and Apple/RevenueCat IAP paperwork hasn't been started. The single biggest lever is therefore **not building more — it's unblocking revenue on the web path now (Stripe config) while starting the long-lead Apple/IAP paperwork in parallel**, and simultaneously closing the three cheap-but-existential trust gaps that would otherwise make any traffic you send through the funnel convert poorly or expose you legally: the **silently-broken web AI brief** (the flagship AI feature renders blank on web), the **data-freshness drift bug** (the dashboard can silently serve last cycle's listings — fatal for a "fresh deals before auction" product), and **fake testimonials + a parallel emerald-branded login page** (FTC risk + the first thing a new user sees is off-brand). Everything else — pricing tweaks, programmatic SEO, the design system spine, Gemini cost optimization — is real but premature until people can pay and the funnel is trustworthy.

---

## 2. Top 7 highest-leverage moves (ranked across all domains)

| # | Move | Domain | Why it's high-leverage | Effort |
|---|------|--------|------------------------|--------|
| **1** | **Turn on Stripe Customer Portal + Smart Retries in the live Dashboard** | SaaS | Code is already wired (`billing-portal/route.ts`). This is the difference between "can't charge anyone" and "web is live-for-pay." Nearly free. | **S** |
| **2** | **Fix the broken web AI brief** — have `generate-brief` fetch the lead server-side by `lead_id` and persist the result to `off_market_leads.ai_brief`; web currently sends an empty payload AND ignores the returned brief, so it renders blank. | AI | The flagship AI feature produces *nothing* on web today. Highest-ROI AI change by far; it's a correctness bug, not an optimization. | **S** |
| **3** | **Add the data-freshness guard + "data as of [date]" stamp + index-drift alert** | SaaS | The entire value prop is "fresh scored inventory before an auction." The `auction_index_drift` bug can silently serve stale snapshots — simultaneously an activation killer and a churn driver on the one promise that matters. | **S–M** |
| **4** | **Start Apple/RevenueCat IAP paperwork now** (App Store Connect agreements → RevenueCat products mapped to the 3 tiers → TestFlight purchase/restore) | SaaS | The only *large* unshipped monetization task and the one with weeks of external latency (Apple review). iOS can't charge until it ships. Must run in parallel, not after. | **L** |
| **5** | **Kill the trust/legal landmines:** replace fake testimonials + "50,000+ properties" stat (FTC endorsement risk); collapse the emerald auth funnel into brand blue/cyan; add the estimate/confidence disclaimer to every max-bid/ARV surface (web brief has none). | Design + SaaS | Cheap diffs that close a real legal risk and fix the first impression. The login page is currently a second brand. | **S** |
| **6** | **Capture demand while you can't fully charge:** ship the free "[County] Tax Sale List + flagged deals" lead magnet behind email capture + "notify me when the next sale drops" on the existing `notify-tax-sale` edge fn; flip Google OAuth consent to External + published (currently 403s all external users). | SaaS | Banks the audience now, reuses data + infra you already have, and removes a hard signup wall. OAuth 403 is blocking signups today. | **S–M** |
| **7** | **Instrument ONE activation event** (e.g., viewed full analysis on ≥3 ranked deals + 1 possessive action within 72h) + ship the web numeral system (`tnum`, U+2212, trailing zeros) and unify the all-blue status/score colors to the semantic green/amber/rose set on mobile. | SaaS + Design + AI | Makes every later decision measured not guessed; the numeral + color fixes are what move the money screens from "template" to "instrument-grade" trust. | **S–M** |

**Cut line:** paid ads, a 4th pricing tier, a sales motion / up-market pivot, Gemini model swaps & eval harnesses, the full design-system spine (OKLCH ramp, shared token source), and any LTV:CAC / Rule-of-40 math — **all deferred until payments are live and there's real user signal.** Doing them now optimizes a zero.

---

## 3. Unified 90-day roadmap

Legend: **[OP]** = blocked on operator action (Stripe/Apple/OAuth/Google) · **[BUILD]** = buildable now by the agent.

### Weeks 1–2 — Unblock revenue + stop the bleeding
- **[OP]** Turn on **Stripe Customer Portal + Smart Retries** (Move 1). *~minutes.*
- **[OP]** Start **Apple/RevenueCat IAP** agreements + tax/banking (Move 4). *Kick off day one — it's the long pole.*
- **[OP]** Flip **Google OAuth consent → External + published** (Move 6).
- **[BUILD]** Fix the **web AI brief** (Move 2): server-side lead fetch + persist `ai_brief`; verify on web *and* mobile, survives reload.
- **[BUILD]** Ship the **data-freshness guard + "data as of" stamp + drift alert** (Move 3).

### Weeks 2–4 — Trust + capture
- **[BUILD]** Replace **fake testimonials / "50,000+"** stat; collapse the **emerald auth funnel** into brand; add **disclaimer + confidence** to web brief and every max-bid/ARV surface (Move 5).
- **[BUILD]** Ship the **free county tax-sale list lead magnet + waitlist + "notify me" alert** on the existing edge fn (Move 6).
- **[BUILD]** **Instrument the one activation event**; wire cohort retention curves tagged by auction cycle (Move 7).
- **[BUILD]** **Web numeral system** + unify **mobile all-blue status/type colors** to semantic set; fix error-is-blue; self-host fonts via `next/font` (Move 7 + design P0s).

### Weeks 4–8 — Activation + conversion engine
- **[BUILD]** Add **first-login county/buy-box question + populated first dashboard**; *extend* (don't rebuild) the existing onboarding checklist.
- **[BUILD]** Give **1–2 free unlock credits during trial**; trigger upgrade prompt on exhaustion.
- **[OP-decision + BUILD]** **Decide trial length** (keep 30-day card-up-front vs. test 7–14 day) and A/B-instrument it. *Do NOT add a cardless reverse trial.*
- **[BUILD]** **Compress Pro toward ~$89–99** and **test annual discount down to 20–25%** (currently ~30–33%).
- **[BUILD]** Launch **programmatic SEO** across covered counties (data-rich pages only) + begin **weekly founder content** + 12-week community hustle.
- **[BUILD, AI]** Cheap prompt hardening: strengthen null/never-compute rule (covers nulled non-residential records), `<UNTRUSTED_DATA>` fence, deterministic fallback brief.

### Weeks 8–12 — Retention + first expansion
- **[BUILD]** Build the **calendar-anchored retention loop** (countdown + pre-auction digest + post-auction recap) — the retention *product* for an episodic tool.
- **[BUILD + OP]** Ship **Pause-before-cancel**; turn on the **dunning sequence** (inert until payments live).
- **[BUILD]** Wire the **referral loop** on the existing unlock-credit system; sign **1 creator affiliate** (rev-share).
- **[BUILD, internal]** County-pipeline robustness: upsert-by-stable-key + `run_id`/checkpointing; cap self-annealing at ~3 attempts → structured escalation; codify known bug classes (ROI band, $0 rehab, non-residential nulling, index currency) as Python assertions.
- **[OP-gated, optional]** Scope the **unlock top-up purchase flow** only if pursuing credit expansion (net-new — only subscription Checkout exists today).

**Note on dependencies:** the entire iOS revenue path (Apple/IAP) and self-serve web billing (Stripe Portal) are operator-gated and should be in motion by end of Week 1. Almost everything else is buildable now and does not need to wait — but **do not scale acquisition (SEO/content/ads) until the freshness guard + activation instrumentation are in**, or you'll pour traffic into a funnel you can't measure or trust.

---

## 4. Open strategic questions for the operator

1. **Trial model: keep the 30-day card-up-front, or test a 7–14 day window?** You've already shipped the high-converting card-required variant — the only lever left is *length* (shorter = faster urgency + faster conversion signal). This is a revenue-timing bet only you can call. *(Do not reopen "cardless reverse trial" — it contradicts the shipped middleware-enforced model.)*

2. **Pro pricing vs. coverage: hold $109 or compress to ~$89–99?** At $109 you're competing with nationwide PropStream/DealMachine while covering 3 GA counties. Compressing protects conversion now; holding bets that you'll widen coverage fast enough to justify the price. Which is the real near-term plan — **price down, or expand counties?**

3. **Sequencing of county expansion vs. depth-in-Georgia.** Coverage is simultaneously the moat, the justification for Pro/Expert pricing, and the prerequisite to charging for "more counties" as an upsell. Do you go wide (new states/counties) or deep (more data/automation per existing county) first? This shapes the whole expansion-revenue story.

4. **Status-color brand rule: ratify overriding "alerts stay blue."** The evolve-path deliberately retires an existing brand-guide decision (mobile's all-blue danger/warning) in favor of semantic red/amber/green. That's correct for the category and color-blind safety — but it's a conscious retirement of a prior brand choice. Confirm you're OK overriding it.

5. **Provenance commitment under growth pressure.** Your FAQ promises "no MLS scraping / public-records-only / licensed partnerships only." Any future off-market or MLS data must come through that compliant path. Are you committed to holding that line even if a faster, grayer data source appears? It's both a legal and a trust asset — and only you can decide the posture.