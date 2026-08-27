Every critique claim is now verified against the codebase:

- Card-required 30-day trial: live (checkout/route.ts + FAQ "card is not charged until day 30")
- Onboarding checklist: exists (browse/pipeline/export, no first-login county question)
- Billing portal: code-complete and wired
- Pricing: $39/$109/$249 monthly; annual discounts ~30-33%; unlock counts already set (10/25+5/unlimited)
- Disclaimer posture: FAQ has "Does BidWise guarantee returns? No" + "we do not scrape MLS"
- Stale dated snapshots present: dekalb_2026-04-07/05-05/06-02.json, plus cobb/gwinnett dated files
- Top-up purchase flow: no matches found — confirms "one-tap top-ups" would be net-new build

I have everything needed to produce the corrected report.

---

# BidWise SaaS Lifecycle Strategy

*Pre-revenue, bootstrapped, solo-operated tax-deed SaaS. Georgia (DeKalb / Cobb / Gwinnett), Next.js web + Expo iOS, shared Supabase backend.*

**Build-status reality check (done before writing this revision — every recommendation below was checked against the actual codebase):**
- The web trial is **already card-required**: `web/app/api/stripe/checkout/route.ts` creates a `mode:'subscription'` Checkout with `trial_period_days: 30` (Stripe collects a card by default in subscription mode), and `web/lib/faq-data.ts` ships the live FAQ "Your card is not charged until day 30." So "switch to a card-required trial" is **not** an open task — it's the current model.
- The **onboarding checklist already exists** (`web/app/onboarding/page.tsx`: a 3-step browse → pipeline → export checklist). The genuinely missing piece is a first-login county/buy-box question.
- **Stripe Customer Portal is code-complete and wired** (`web/app/api/stripe/billing-portal/route.ts` → `DashboardClient.tsx`). The only blocker is a ~10-minute config in the live Stripe Dashboard (`directives/launch_deploy_runbook.md` line 89: "0 live configs"). It is **not** an engineering project.
- Pricing/unlock counts are **already set in `web/lib/pricing-data.ts`**: Starter $39/mo ($329/yr, 10 unlocks), Pro $109/mo ($899/yr, 25 auction + 5 off-market), Expert $249/mo ($1999/yr, unlimited). Annual discounts compute to ~30–33%.
- There is **no top-up / pay-per-unlock purchase flow** in the codebase — only subscription Checkout. "One-tap top-ups on exhaustion" is a real net-new build, not a config.
- `web/data/` contains **dated snapshot files** (`dekalb_2026-04-07.json`, `…05-05`, `…06-02`, plus cobb/gwinnett dated files), and project memory documents a live **auction-index-drift staleness bug** — relevant to the data-freshness risk section below.

---

## The two things that actually gate revenue (and they are not the same size)

The original synthesis collapsed "make payment possible" into one P0. In reality there are two very different tasks, and conflating them misallocates the operator's attention:

1. **Stripe live-mode config (≈ minutes, not engineering).** Turn on the Customer Portal in the live Stripe Dashboard and toggle Smart Retries. The code already exists. This unlocks self-serve upgrade/downgrade/cancel and failed-payment recovery for the **web** path. Do it first because it's nearly free [10][53].
2. **Apple / RevenueCat IAP (real, multi-step work).** This is the actually-large unshipped revenue task and is iOS-only. It requires App Store Connect paid-apps agreements + tax/banking, RevenueCat product + entitlement config mapping to the three tiers, and a TestFlight build that exercises purchase + restore. Per project memory the outstanding launch gates are "web env vars + Stripe Portal + RevenueCat/Apple" — IAP is the one with weeks of latency (Apple review, agreement propagation), so start its paperwork in parallel with everything else.

**The honest framing:** the web funnel can be live-for-pay almost immediately (Stripe config); iOS cannot. So sequence web monetization first and treat IAP as a parallel track with its own timeline, not a peer bullet to a Dashboard toggle.

Second cross-cutting theme, unchanged and correct: **you are pre-revenue with low volume — instrument one activation event now** so future decisions are measured, not guessed [1][40].

---

## 1. Pricing & Packaging

**Verdict:** The 3-tier structure (Starter $39 / Pro $109 "Most Popular" / Expert $249) is sound — three tiers tend to convert better than two or four-plus via the center-stage effect, and Pro-as-anchored-middle is correct [3][9]. The live config already implements card-up-front trialing and ~30–33% annual discounts, so the open questions are narrower than the original report implied.

| Priority | Action | Why |
|---|---|---|
| **P0 (config)** | **Turn on Stripe Customer Portal + Smart Retries in the live Dashboard.** Code is already wired (`billing-portal/route.ts`). | This is a Dashboard toggle, not a build. It's the self-serve upgrade/downgrade + dunning surface for web [10][53]. |
| **P0 (real build)** | **Stand up Apple/RevenueCat IAP** (App Store Connect agreements → RevenueCat products mapped to the 3 tiers → TestFlight purchase/restore). | The only large unshipped monetization task; iOS can't charge until it ships. Start the Apple paperwork now for review latency. |
| **P1 (decision, not build)** | **Resolve the trial-model contradiction.** The web trial is *already* card-up-front, 30 days. So the choice is: **keep 30-day card-up-front** vs **test a shorter 7–14 day card-up-front window** (faster sense of urgency, quicker conversion signal). Do **not** "add a reverse trial" — a reverse trial is cardless, which is mutually exclusive with the card-up-front model you've already shipped and enforce in `middleware.ts`. | Card-required trials convert materially higher than opt-in (2026 ChartMogul-style benchmarks: opt-in median ~8.9%, opt-out/card-required median ~44%) — you already have the high-converting variant; the only lever left is trial *length* [1][4]. |
| **P1** | **Re-anchor the ladder against the niche.** The $39→$109 jump is 2.8x, wider than the healthy ~1.8–2.3x. Either pull Pro toward **~$89–99** or hold $109 and aggressively merchandise the differentiated value (off-market unlocks, watchlists, AI brief). | Pro at $109 competes with **nationwide** PropStream/DealMachine while BidWise covers **3 GA counties** — a value-perception gap until coverage expands [3]. (Competitor price points below are vendor-page figures; verify the live PropStream page before quoting.) |
| **P1** | **Keep annual as the default**, but recognize the live config already discounts ~30–33% (Starter $329 vs $468, Pro $899 vs $1308, Expert $1999 vs $2988 per `pricing-data.ts`). **Test pulling that toward ~20–25%** to protect margin. | General benchmarks put the optimizing band around 15–25%; >25% shows diminishing returns. You're currently above it — this is grounded in your own config, not a benchmark guess [5][6]. |
| **P2** | **Starter's 10 unlocks/mo (already set in config) is probably too thin** to let a trialing user feel the product. Test 15–20, or make the first 1–2 unlocks free during trial. | Value-metric allotments that feel usable drive activation; an allotment that runs out before the "aha" suppresses conversion [10][11]. |
| **P2 (net-new build, scope it)** | **If you want unlock top-ups, you must build the purchase flow** — only subscription Checkout exists today (no pay-per-unlock route in the codebase). Scope it as: one-time Stripe Checkout (or Payment Intent) for unlock packs + a server-side credit ledger. Then surface "X unlocks left this month" and offer top-ups on exhaustion. | "Reposition unlocks as overage top-ups" is real engineering, not copy. Don't recommend "one-tap top-ups" as if the rails exist — they don't [10][11]. |
| **P2** | **Contextual paywalls** at peak motivation with specific copy — "Unlock this DeKalb deal" / "See the AI brief on this lead" — never generic "Upgrade now." (Illustrative: structural/contextual paywalls generally outperform copy-only tweaks; treat the specific win-rate stats as directional, not load-bearing [7][8].) | Specificity at the moment of intent is the cheap lever. |
| **P2** | **Time-limited Founders cohort** with grandfathered rate-lock (first ~100 paying users keep current prices) — **not a lifetime deal.** | LTDs attract the wrong customers and cap ARR; grandfathered founder pricing seeds engaged early adopters while preserving recurring revenue [12]. |
| **P3** | Keep **three** public tiers; don't add a 4th. Pre-select/highlight Pro, keep Expert as the high anchor (`highlight:true` on Pro is already set). | 4+ tiers dilute the center-stage effect [3][9]. |

**Pricing synthesis:** hold Starter at $39, **pull Pro toward ~$89–99** until county coverage expands, keep Expert $249 as the anchor. The Pro compression is the single most important change — it's where the value-perception fight is being lost against nationwide competitors.

---

## 2. Go-to-Market & Acquisition

**Verdict:** For a bootstrapped pre-revenue niche tool, the highest-ROI path is **founder-led organic distribution + a programmatic-SEO data moat — not paid ads.** Do not run paid until trial-to-paid and retention are proven on real cohorts. (Generic channel-CAC tables from B2B-SaaS benchmarks are omitted here — they aren't tax-deed-specific and the original report's $141–200/$200–800/$500–1,500 ranges added length without telling you anything about *this* niche. The directionally-true takeaway is the only part worth keeping: referrals and founder-organic are cheapest; paid is wrong at this stage [16][18].)

### The BidWise-specific GTM stack

- **P0 — Capture-before-monetize.** iOS can't charge yet and web is one Stripe toggle away, so the urgent move is to **bank demand**. Ship a **free, auto-updating "[County] Tax Sale List + flagged deals"** for DeKalb/Cobb/Gwinnett behind an email capture, plus **"notify me when [county]'s next sale drops"** built on the existing `notify-tax-sale` edge function. This is exactly what tax-deed investors hunt for manually, it reuses data you already generate, and it's an acquisition + retention twofer [17][29].

- **P1 — Programmatic SEO moat (the compounding engine, and the one no competitor blog can copy).** Generate one indexable, **data-rich** page per county and per upcoming sale: *"[County] GA Tax Deed Sale — Dates, Property List & Deal Analysis"* populated with real auction dates, parcel counts, historical results, and sample deal scores. **Every page must carry unique BidWise data** — thin templated pages get suppressed and can drag the whole domain [19]. Comparable scale precedents exist (programmatic real-estate content scaling into six-figure page counts) [19][21], but the moat here is specifically *your proprietary scored inventory*, not page volume.

- **P1 — Founder-led content cadence.** Weekly long-form YouTube deal teardowns ("I scored every DeKalb tax deed this month — here are the 3 worth bidding"), repurposed into Shorts + blog. **Lead with transparency and real numbers, including losses** — this is a scam-wary audience saturated with $5K courses, so credibility is the entire game [16][24].

- **P1 — Manual community hustle for the first 100.** As the **named founder** (real account, disclosed "I build BidWise" bio — never a brand handle), post value-first several times a week for ~12 straight weeks in BiggerPockets Tax Liens & Tax Deeds, r/realestateinvesting, r/taxliens, and Georgia REI Facebook groups [22]. Run an AMA sharing **non-public data** (over-bid counties, real ROI distributions) — the thing only you have [25][26].

- **P2 — Creator affiliate partnerships (rev-share, not flat sponsorships).** Pitch tax-deed educators (Tax Sale Academy, The Tax Sale Podcast, etc.) on **commission per paying user** to preserve cash; give their audience the free county list. Trust-transfer converts far better than cold ads in this niche [26][27][30].

- **P2 — Referral loop on the existing unlock-credit system** ("give a free unlock, get one"). Bake it into onboarding so the first cohort partly recruits itself [18].

- **P3 — iOS ASO (secondary until web PMF + IAP ship).** Keyword-rich title, A/B-tested screenshots, Custom Product Pages per channel, Day-7 retention focus [28][31]. Don't over-invest before the web funnel converts and IAP is live.

**90-day GTM targets** (to feed the self-annealing loop): ~500 waitlist emails, 50+ county SEO pages live/indexed, ~12 founder content pieces, 1 creator affiliate signed, free auction-list + alert flow shipped — all with per-signup channel attribution.

---

## 3. Activation & Onboarding

**Verdict:** Activation — not signup — predicts conversion, and the free-to-paid decision is largely made in the first session/72h [34][41]. BidWise's "aha" is not "saw a dashboard" — it's **"examined a specific deal they believe is real and worth bidding on."** The standard PLG onboarding canon (≤3 fields, defer push, kill empty states) applies but is well-trodden; the BidWise-specific gaps are what matter, and one of them is that **a checklist already exists** — so the work is *improving* it, not building it.

**Candidate activation event:** *viewed full deal analysis (ARV / max-bid / score) on 3+ ranked deals AND took 1 possessive action (watchlist / unlock / generate AI brief / export) within the first session or 72h.* Validate against real cohorts once data exists [32][44].

| Priority | Action | Evidence / codebase note |
|---|---|---|
| **P0** | **Instrument the activation event first** (county-selected, filter-set, deal-unlocked, brief-generated, watchlist-add, alert-set → Supabase events → activation-rate report). | Without this, all conversion tuning is blind [32][40]. |
| **P0** | **Add the missing first-login county/buy-box question and render that county's ranked deals on first dashboard load** (seed demo deals if no live auction). User sees a real scored deal in <2 min. | The onboarding *checklist* already exists (`web/app/onboarding/page.tsx`); what's missing is the county/buy-box capture and a populated first dashboard. This is the genuinely new build, not "add a checklist" [35][37]. |
| **P1** | **Improve the existing 3-step checklist** (browse → pipeline → export). Add the buy-box step, a populated-state preview, and (once a real conversion event exists) tie completion to the upgrade prompt. | Reframe from "build a checklist" to "extend the one in `onboarding/page.tsx`." Checklist completion correlates with higher trial conversion (treat the "2–3x" figure as directional) [33][34]. |
| **P1** | **Give 1–2 free unlock credits during trial** so users feel the full locked analysis; trigger the upgrade prompt on exhaustion. | Concrete aha now + a clean conversion event once billing is live [38][46]. |
| **P1** | **Fix mobile signup friction + the OAuth blocker.** One-tap Apple Sign In + Google, ≤3 fields, let users browse deals before forcing account creation. **Blocker:** Google OAuth consent is still "Internal" → 403s for all external users — flip to External + publish (project memory). | Each extra field costs conversion; the OAuth 403 is a hard wall, not an optimization [42][43]. |
| **P1** | **Defer + value-prime push permission** — never during onboarding. After a watchlist add, show "Get alerted before this auction." Auction deadlines are a legitimate, non-spammy push hook (app has `device_tokens`) [42][45]. | |
| **P1** | **Behavioral lifecycle emails** (4–6 over 14 days, concentrated in first 72h), triggered by inaction + watchlist countdowns. Reuse existing Resend + edge-function infra. | Behavioral triggers outperform calendar blasts [34]. |
| **P2** | **Differentiate web vs mobile flows.** Web carries richer setup (multi-county, detailed buy-box); mobile stays value-first, native pickers, fast path to one deal. | Don't ship one identical flow [42]. |
| **P2** | **Make fresh inventory the retention loop** — "new deals in your county this week" + watchlist reminders surfaced in onboarding — **but see §4a: this only works if the data is actually fresh** [47]. | |

---

## 4. Retention & Expansion

**Verdict:** BidWise's retention problem is **structural, not a leaky funnel.** The core value event (county auctions) is **episodic/monthly**, so daily-habit playbooks don't apply. The right model is a **calendar-anchored loop** (auction date = trigger) plus inter-auction value (off-market leads, watchlist alerts, AI briefs, pipeline) to justify between-event opens [55]. The episodic-loop insight is the load-bearing one and is elevated here above the generic dunning/pause mechanics — which are premature anyway, since nobody can pay yet.

| Priority | Action | Evidence |
|---|---|---|
| **P0** | **The calendar-anchored loop is the retention product**, not an add-on: "next [county] sale in X days" countdown + pre-auction deal digest (push + email ~7 days out) + post-auction results recap. | This is the BidWise-specific retention engine; stop chasing DAU on an episodic product [55]. |
| **P1** | **Ship Pause-before-cancel** (Stripe pause collection), framed "pause until the next sale season." | Episodic/seasonal is the canonical pause case; a meaningful share of would-be cancellers pause instead of leaving (treat the "~44%" figure as directional) [47][51]. |
| **P1 (config, not build)** | **Smart Retries + a light dunning sequence** (smart retry → email day 0/3/7 → in-app payment wall → card-updater). Smart Retries is a Stripe Dashboard toggle on already-built rails. | Most involuntary churn is recoverable; it's free MRR you'd otherwise lose 100% of [48][52]. Sequence it *after* payments go live — it's inert until then. |
| **P2** | **Credits as the expansion engine, not seats** — usage-threshold upgrade prompts when monthly unlocks run low. (The top-up *purchase flow* is a net-new build — see §1 P2. Don't promise one-tap top-ups before the route exists.) | Usage/credit hybrids tend to post higher net retention [10][50]. |
| **P2** | **County expansion as an explicit upsell** — charge for counties beyond base GA. Each new county is an expansion lever for existing subscribers with no renegotiation. | Cleanest NRR driver for this product [50][57]. |
| **P2** | **Auction-cycle-timed win-back** — fire reactivation ~7–9 days before the user's NEXT county auction, with 2–3 specific deals they'd have unlocked, inside the 30-day window; segment by county + prior unlock behavior. | Beats generic "we miss you"; within-window, segmented win-backs are most effective [52]. |
| **P3** | Report **voluntary vs involuntary churn separately** once paying. Treat NRR as the eventual north-star, but ignore it until there's an installed base to retain. | SMB self-serve churns hot; expansion must outrun logo loss [49][50]. |

### 4a. THE #1 PRODUCT RISK: data freshness & coverage (missing from the original report)

A deal tool whose entire value is "fresh scored inventory **before** an auction" lives or dies on data currency — and BidWise has a **documented staleness failure mode**:

- `web/data/` carries dated snapshots (`dekalb_2026-04-07.json`, `…05-05`, `…06-02`, plus cobb/gwinnett dated files), and project memory (`auction_index_drift.md`) records that the dashboard has **silently loaded stale dated snapshots** when the `{county}_auctions.json` index points at an old file — no error, just old deals with missing `ranked_comps`/`asis` fields.
- If a user opens the app the week of an auction and sees last cycle's listings (or a deal that was already pulled), that is simultaneously an **activation killer** (the first session shows stale junk) and a **churn driver** (the one promise — current inventory — is broken).

**Actions:**
- **P0 — Add a data-freshness guard + visible "data as of [date]" stamp** on every county view; refuse to render (or banner-warn) if the active snapshot is older than the current auction cycle. `run_ga_county.py` already calls `update_index_to_main` unconditionally — wire an automated check that the index resolves to the newest snapshot and alert the operator on drift.
- **P1 — Coverage is the moat AND the prerequisite to pro-tier pricing.** 3 GA counties is a credibility gap vs nationwide competitors; widening coverage is what justifies a $109+ Pro and any future "Expert/Team" tier.

### 4b. ACCURACY LIABILITY & DISCLAIMER POSTURE (missing from the original report)

BidWise outputs ARV, max-bid, deal scores, and ROI that users **bid real money on**. A wrong max-bid that loses someone $40k is the #1 reputation-and-churn risk for this niche — and the original report's "make max-bid the hero of the landing page" advice ignored it entirely.

- The FAQ already has the right posture seeds: *"Does BidWise guarantee returns? No… investing still involves real risk"* and the data-provenance line *"We do not scrape MLS systems, access restricted portals, or use data obtained through unauthorized means"* (`web/lib/faq-data.ts`).
- **P1 — Make the max-bid the hero of the marketing, but pair every estimate with a visible "estimate, not advice" disclaimer + a confidence indicator** (the config already exposes "confidence scores" on Pro). Surface comp count / data recency next to each estimate so users self-calibrate.
- **P1 — Keep the no-scrape / public-records provenance claim prominent and TRUE.** It's both a trust asset and a legal one; any future MLS/off-market data must come through the "compliant, licensed partnerships only" path the FAQ already promises — don't quietly violate your own stated provenance.
- **P2 — Add a one-line terms acknowledgment** at unlock ("BidWise estimates are decision support, not a guarantee or financial advice") so the disclaimer is contractually present at the moment of the money decision, not just buried in an FAQ.

---

## 5. Metrics & Unit Economics

**Verdict (trimmed):** The original report correctly said to ignore LTV:CAC, CAC payback, magic number, Rule of 40, SaaS Quick Ratio, and NRR pre-revenue — then spent a full section on them anyway. At n<10 those are noise. The single tailored line is all that belongs here:

> **Now:** instrument **ONE** activation event in PostHog/Supabase (e.g., "within 72h: views full analysis on ≥3 ranked deals AND takes 1 possessive action") and watch activation %, week-1/week-4 retention, and time-to-first-value. **Ignore every financial ratio until ≥10–20 paying customers / ~$1–5K MRR.** [40][63]

Two BidWise-specific cost notes that *are* worth tracking from day one (because the unlock product is usage-metered and has real variable COGS):

- **Per-unlock unit economics are the real variable cost.** Each unlock can trigger Gemini AI-brief tokens + Apify comps scraping. You already have the instrumentation — `ai_usage_events` / `ai_usage_summary` + daily caps + a kill switch (`gemini-brief-cost-controls.md`). **Extend that existing telemetry to a COGS-per-unlock figure** rather than treating "protect margin >70%" as a fresh, generic concern. If you ship unlock top-up packs (§1 P2), price the pack above COGS-per-unlock with margin — that's the one place a usage product can go cash-flow-negative.
- **Enable Stripe Smart Retries** the moment payments go live — near-zero-effort recovery of failed-card churn [65].

(Instrumentation tooling: PostHog free tier for product/behavioral truth; Stripe as revenue source of truth. Note PostHog's native Revenue Analytics is deprecated after 2026-06-30 — keep Stripe as the financial ledger [59][60].)

---

## 6. Who to anchor on

### Primary customer: **Retail / DIY tax-deed & auction investors.** Anchor here first; sequence *up* into pros/small funds later as a higher-ACV expansion tier — never as a launch target.

**Why retail is the only correct launch anchor:**
- **It's the only self-serve-reachable segment for a solo bootstrapped operator.** Individual-investor CAC is content/SEO/referral-scale; pro/fund acquisition needs field sales you can't staff [72][74].
- **Small investors dominate the market.** Per CoreLogic/Cotality 2024 data: **~60% of 2024 investor home *purchases* were "mom-and-pop" investors**, and **individuals owning 1–10 properties hold ~91% of investor-owned homes**, while **mega-investors are ~2% of purchases** [70]. *(Corrected — the original report's "~85% held by 1–5-property owners; institutions ~2.2%" was not in the cited source.)*
- **The market is real and growing.** U.S. **tax-LIEN** sale volume hit **$5.02B / 1.52M parcels in 2024** (up from $3.8B / 1.32M in 2021) [68]. *(Scoped to liens — this Tax Sale Resources figure is lien-sale volume; tax **deeds** are a different mechanism and a deed-specific TAM is not available from this source.)* Separately, REI software is ~$5.61B (2025) → ~$9.82B (2030) at ~11.85% CAGR [69].
- **WTP is proven in the niche** at roughly $49–99/mo (competitor price points per vendor pages; re-check live pages before quoting) [33][71][73].
- **PLG economics fit:** browse free → pay to unlock → upsell to subscription is the natural motion [74].

**The wedge:** no competitor cleanly owns the full **source → analyze (ARV/rehab/max-bid/deal-score/ROI) → bid → track** loop for tax deeds. **BidWise answers "should I bid and how much" — make the deal-score/max-bid output the hero of the landing page and free preview** (with the §4b disclaimer/confidence posture attached). Competitor coverage/feature claims (e.g. "hundreds of counties / millions of scored properties," specific seat prices) are mostly single-sourced to vendor or affiliate pages — treat them as plausible, not settled, and verify against live pricing pages before repeating them in marketing or pricing decisions.

**The retail risk to engineer around:** SMB/prosumer tools churn hot, and monthly subs churn far faster than annual. Default to annual; make the calendar-anchored loop, watchlists, pipeline, removal-refund tracking, and recurring auction alerts the habit hooks (§4) [72].

**Cautionary precedent — do NOT pivot up-market early:** Roofstock, despite a $1.9B valuation, cut staff twice (~20% then ~27%) and merged with Mynd after chasing institutional money into a cooling market [75]. The pro segment has better LTV but needs sales motion, data depth, and trust BidWise hasn't earned.

### Sequencing

**Phase 1 — Land retail (now → first ~100–1,000 users).** Price in the validated band (Starter $39, Pro pulled to ~$89–99, Expert $249 anchor). Unlock credits as PLG top-of-funnel. Acquisition via §2 (free county list, programmatic SEO, founder content, community hustle). **Engineer retention (data freshness, calendar loop, annual default) before scaling acquisition.** Hard gate: **if monthly churn >5%, fix retention/data-freshness before spending on acquisition.**

**Phase 2 — Expand (after trust + coverage exist).** **Widen county coverage first** — it's the moat and the prerequisite to charging pro prices. Then introduce an **"Expert/Team" expansion tier** (multi-county, bulk CSV/API, saved-search automation, team seats) to capture wholesalers and small funds via **expansion revenue**, not a new sales org. Wholesalers/flippers are a credible second segment — win them on **faster bid/no-bid decisions + deal-desk workflow**, not head-on lead-gen.

---

## Do this next (90 days)

**Weeks 1–3 — Unblock revenue + capture demand + close the data risk:**
1. **Stripe Dashboard config**: turn on Customer Portal + Smart Retries (code already wired — ~minutes) [10][53].
2. **Start Apple/RevenueCat IAP** paperwork + product config in parallel (long-lead; iOS can't charge until done).
3. Ship the **free "[County] Tax Sale List + flagged deals" lead magnet + waitlist** and the **"notify me when [county]'s next sale drops"** alert on the existing `notify-tax-sale` edge fn [17][29].
4. **Add the data-freshness guard + "data as of [date]" stamp** and a drift alert on the auction index — the #1 product risk (§4a).
5. Flip **Google OAuth consent → External + published** (currently 403s all external users).

**Weeks 2–6 — Instrument + activate:**
6. Define and log **one activation event**; wire cohort retention curves + auction-cycle tag [32][40].
7. **Add the first-login county/buy-box question + populated first dashboard**, and **extend the existing onboarding checklist** (don't rebuild it) [33][35].
8. Attach the **estimate/confidence disclaimer** to every max-bid/ARV surface (§4b).

**Weeks 4–10 — Conversion engine + moat:**
9. **Decide trial length** (keep 30-day card-up-front vs test 7–14 day card-up-front) and A/B-instrument it — do NOT add a cardless reverse trial [1].
10. **Compress Pro to ~$89–99** and **test annual discount down toward 20–25%** (you're at ~30–33% today) [3][5].
11. Launch **programmatic SEO** across covered counties (data-rich, hub→spoke) [19][21].
12. Begin the **weekly founder content cadence** + 12-week community hustle as the named founder [16][22].

**Weeks 6–12 — Retention + first expansion:**
13. Build the **calendar-anchored loop** (countdown + pre-auction digest + results recap) — the retention product [55].
14. Ship **Pause-before-cancel**; turn on the **dunning sequence** once payments are live [51][52].
15. **Scope and build the unlock top-up purchase flow** if pursuing credit expansion (net-new — only subscription Checkout exists today) [10].
16. Wire the **referral loop** on the existing unlock-credit system; sign **1 creator affiliate** [18][26].

**Explicitly NOT in the next 90 days:** paid ads (unproven conversion) [18]; a sales motion / pro-fund targeting [72][75]; a 4th pricing tier [3]; deep ASO before web PMF + IAP [28]; computing LTV:CAC / Rule of 40 / Quick Ratio / NRR on n<10 [40]; **adding a cardless reverse trial** (contradicts the shipped card-up-front model).

---

## Sources

[1] ChartMogul — The SaaS Conversion Report: https://chartmogul.com/reports/saas-conversion-report/
[2] Monetizely — SaaS Pricing Benchmark Study 2025: https://www.getmonetizely.com/articles/saas-pricing-benchmark-study-2025-key-insights-from-100-companies-analyzed
[3] saasfactor — The 2025 SaaS Pricing Playbook: https://www.saasfactor.co/blogs/the-2025-saas-pricing-playbook-how-to-choose-the-right-model
[4] saasfactor — Freemium vs Trial Models in SaaS: https://www.saasfactor.co/blogs/freemium-vs-trial-models-in-saas-what-really-boosts-conversions
[5] Heap — How Much Should I Discount for Prepaid SaaS Contracts: https://www.heap.io/blog/how-much-should-i-discount-for-prepaid-saas-contracts
[6] Glencoyne — Annual Prepayment Discount Optimization: https://www.glencoyne.com/guides/annual-prepayment-discount-optimization
[7] RevenueCat — Contextual Paywall Targeting: https://www.revenuecat.com/blog/growth/contextual-paywall-targeting/
[8] Apphud — How to Design a High-Converting Paywall: https://apphud.com/blog/design-high-converting-subscription-app-paywalls
[9] Potio — Compromise, Anchoring and Decoy Effects: https://www.potio.cc/blog/pricing-strategies-compromise-anchoring-decoy
[10] Schematic HQ — Credit-Based Pricing Explained for SaaS: https://schematichq.com/blog/credit-based-pricing
[11] Chargebee — Definitive Guide to Prepaid Credits for AI & SaaS: https://www.chargebee.com/pricing-labs/prepaid-credit-pricing-guide/
[12] Freemius — SaaS Lifetime Deals: When to Run One: https://freemius.com/blog/saas-lifetime-deals/
[13] daydream — Landing Page Conversion Rate Benchmarks for SaaS: https://www.withdaydream.com/library/insights/average-landing-page-conversion-rate
[14] FastLien pricing: https://fastlien.co/
[15] Tax Sale Resources — Pricing: https://www.taxsaleresources.com/pricing
[16] Freemius — State of Micro-SaaS 2025: https://freemius.com/blog/state-of-micro-saas-2025/
[17] PayProGlobal — How to Get Your First 100 Customers for SaaS: https://payproglobal.com/how-to/get-first-100-customers/
[18] Data-Mania — B2B Tech Startup CAC Benchmarks 2026: https://www.data-mania.com/blog/cac-benchmarks-for-b2b-tech-startups-2025/
[19] Averi — Programmatic SEO for B2B SaaS Startups (2026 playbook): https://www.averi.ai/blog/programmatic-seo-for-b2b-saas-startups-the-complete-2026-playbook
[20] Amra & Elma — Top 20 SaaS Customer Acquisition Statistics 2026: https://www.amraandelma.com/saas-customer-acquisition-statistics/
[21] Omnius — Programmatic SEO Case Study (67 to 2100 Signups): https://www.omnius.so/blog/programmatic-seo-case-study
[22] BiggerPockets — Tax Liens & Tax Deeds forums: https://www.biggerpockets.com/forums/79/topics/120317-tax-liens-and-tax-deeds
[23] Feedspot — 70 Tax YouTubers / tax-deed educators: https://videos.feedspot.com/tax_youtube_channels/
[24] Thoughtlytics — SaaS YouTube Strategy (67 to 1000 Subscribers): https://www.thoughtlytics.com/newsletter/saas-youtube-growth-strategy
[25] OutreachBloom — How to Use Reddit to Drive Pipeline for B2B SaaS: https://outreachbloom.com/reddit-pipeline/
[26] Jonathan Rintala — Reddit Growth Guide for B2B SaaS: https://jonathanrintala.com/blog/reddit-growth-hacking-guide-b2b-saas/
[27] OutlierKit — YouTube Sponsorship Rates 2026 by niche: https://outlierkit.com/resources/youtube-sponsorship-rates/
[28] Apptweak — ASO Trends & Benchmarks Report 2025: https://www.apptweak.com/en/aso-blog/aso-app-store-trends-benchmarks-report
[29] Tax Lien Code: https://taxliencode.com/
[30] The Tax Sale Podcast: https://podcasts.apple.com/us/podcast/the-tax-sale-podcast-investing-in-tax-deeds-tax-liens/id1396193535
[31] SplitMetrics — App Store Keyword Optimization 2025: https://splitmetrics.com/blog/app-store-keyword-optimization/
[32] PostHog — How we found our activation metric: https://posthog.com/product-engineers/activation-metrics
[33] Appcues — Double your trial-to-paid conversions with smarter onboarding: https://www.appcues.com/blog/trial-to-paid-conversions-user-onboarding
[34] 1Capture — Free Trial Conversion Benchmarks 2025: https://www.1capture.io/blog/free-trial-conversion-benchmarks-2025
[35] Userpilot — Empty State in SaaS Applications: https://userpilot.com/blog/empty-state-saas/
[36] Userpilot — Reverse Trial Method: https://userpilot.com/blog/saas-reverse-trial/
[37] ProductQuant — The 5-Minute Aha Rule: https://productquant.dev/blog/5-minute-aha-rule-optimize-ttv/
[38] Zibly.ai — SaaS Monetization Playbook 2025 (Freemium vs Trial vs Reverse): https://medium.com/@zibly.ai/the-saas-monetization-playbook-for-2025-freemium-vs-free-trial-vs-reverse-trial-7f53b8aeec27
[39] ADV.me — SaaS Free Trial Conversion Rate Benchmarks 2025: https://adv.me/articles/conversion-optimization/saas-free-trial-conversion-rate-benchmarks-2025/
[40] Amplitude 2025 Product Benchmark Report (via Agile Growth Labs): https://www.agilegrowthlabs.com/blog/user-activation-rate-benchmarks-2025/
[41] Amplitude — What is Activation Rate for SaaS Companies: https://amplitude.com/explore/digital-analytics/what-is-activation-rate
[42] Chameleon — Mobile vs Web App Onboarding: https://www.chameleon.io/blog/mobile-vs-web-app-onboarding
[43] NextNative — 7 Mobile Onboarding Best Practices for 2025: https://nextnative.dev/blog/mobile-onboarding-best-practices
[44] buildmvpfast — How to Measure Activation for B2B SaaS (2026): https://www.buildmvpfast.com/questions/how-to-measure-activation-for-b2b-saas
[45] Pushwoosh — How to increase push notification opt-in rate: https://www.pushwoosh.com/blog/increase-push-notifications-opt-in/
[46] VWO — The Ultimate Mobile App Onboarding Guide (2026): https://vwo.com/blog/mobile-app-onboarding-guide/
[47] Chargebee — The Power of Pause: https://www.chargebee.com/blog/power-of-pause-subscription-retention-strategy/
[48] Churnkey — State of Retention 2025: https://churnkey.co/reports/state-of-retention-2025
[49] Optifai — B2B SaaS NRR Benchmarks: https://optif.ai/learn/questions/b2b-saas-net-revenue-retention-benchmark/
[50] Growth Unhinged (Kyle Poyar) — 2025 State of SaaS Pricing Changes: https://www.growthunhinged.com/p/2025-state-of-saas-pricing-changes
[51] Churnkey — What's a Normal Churn Rate in SaaS: https://churnkey.co/blog/whats-a-normal-churn-rate-in-saas/
[52] GetMonetizely — Tracking Win-Back Campaign Effectiveness: https://www.getmonetizely.com/articles/how-to-track-win-back-campaign-effectiveness-a-complete-guide-for-saas-executives
[53] Slicker — Involuntary Churn Benchmarks 2025: https://www.slickerhq.com/resources/blog/involuntary-churn-benchmarks-2025-industry-numbers-ai-recovery-impact
[54] Amplitude — Time to Value Drives User Retention: https://amplitude.com/blog/time-to-value-drives-user-retention
[55] andrewchen — Habit-Forming Feedback Loops: https://andrewchen.com/how-to-design-successful-social-products-with-3-habit-forming-feedback-loops/
[56] DigitalApplied — SaaS Onboarding Email Sequences 2026: https://www.digitalapplied.com/blog/saas-customer-onboarding-email-sequence-2026-crm-playbook
[57] DigitalApplied — Net Revenue Retention Benchmarks 2026: https://www.digitalapplied.com/blog/net-revenue-retention-benchmarks-2026-saas-expansion-data
[58] Pushwoosh — Push Notification Benchmarks 2025: https://www.pushwoosh.com/blog/push-notification-benchmarks/
[59] PostHog — The most useful B2B SaaS product metrics: https://posthog.com/product-engineers/b2b-saas-product-metrics
[60] PostHog — Getting started with revenue analytics (deprecation notice): https://posthog.com/docs/revenue-analytics/start-here
[61] PostHog — Stripe payment platform (sync modes): https://posthog.com/docs/revenue-analytics/payment-platforms/stripe
[62] Fiscallion — SaaS Quick Ratio: https://www.fiscallion.io/blog/saas-quick-ratio
[63] Benchmarkit — 2025 SaaS Performance Metrics: https://www.benchmarkit.ai/2025benchmarks
[64] Vena — 2025 SaaS Churn Rate Benchmarks: https://www.venasolutions.com/blog/saas-churn-rate
[65] Eagle Rock CFO — SaaS Benchmarks by Stage (2026): https://www.eaglerockcfo.com/blog/research/saas-finance-metrics-benchmarks
[66] Stripe — SaaS analytics tools / Sigma & MRR guidance: https://stripe.com/resources/more/saas-analytics
[67] Bantrr — CAC Payback Benchmarks for SaaS: https://bantrr.com/business-model/saas-metrics/cac-payback-benchmarks-for-saas-companies/
[68] Tax Sale Resources — Analyzing Tax Lien Sales Trends (tax-LIEN volume): https://www.taxsaleresources.com/blog/tax-lien-sales-trends
[69] Mordor Intelligence — Real Estate Investment Software Market: https://www.mordorintelligence.com/industry-reports/real-estate-investment-software-market
[70] Cotality/CoreLogic — Mom-and-Pop Investors Shape the Housing Market (2024): https://www.cotality.com/insights/articles/mom-and-pop-investors-shape-housing-market (and World Property Journal / CoreLogic 2024: https://www.worldpropertyjournal.com/real-estate-news/united-states/irvine/real-estate-news-real-estate-investor-data-for-2024-corelogic-housing-market-investor-research-for-2024-institutional-property-investor-data-for-2024--14327.php)
[71] LienSuite — Best Software for Tax Lien & Tax Deed Investors 2026 (vendor roundup — verify figures): https://liensuite.com/blog/best-software-tax-lien-deed-investors-2026
[72] Qubit Capital — PropTech SaaS KPI Benchmarks: https://qubit.capital/blog/proptech-saas-kpi-benchmarks
[73] PropStream — Pricing (verify live before quoting): https://www.propstream.com/pricing
[74] Userflow — Product-Led Growth Ultimate Guide: https://www.userflow.com/blog/product-led-growth-the-ultimate-guide-for-saas-success
[75] TechCrunch — Roofstock cuts 27% of staff: https://techcrunch.com/2023/03/22/roofstock-valued-at-1-9b-last-year-cuts-27-of-staff-in-second-round-of-layoffs/