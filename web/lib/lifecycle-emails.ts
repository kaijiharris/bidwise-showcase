// Lifecycle emails for the subscription funnel — welcome (trial start) and
// trial-ending reminder. Called from the Stripe webhook, so every function
// here follows lib/email.ts's contract: NEVER throws, no-ops when Resend env
// vars are absent. Email is a courtesy layer; entitlements never depend on it.
//
// The trial-ending reminder is also dispute armor: the ToS says payments are
// non-refundable, so the customer must be warned before the day-N charge.

import { sendEmail, escapeHtml, type SendEmailResult } from './email'
import { TRIAL_DAYS } from './trial'

const SITE_URL = 'https://www.bidwiseinvest.com'
const SUPPORT_EMAIL = 'support@bidwiseinvest.com'

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  expert: 'Expert',
}

export function planDisplayName(plan: string | null | undefined): string {
  if (!plan) return 'BidWise'
  return PLAN_NAMES[plan] ?? plan
}

/** "September 1, 2026" from a Stripe epoch-seconds timestamp; null-safe. */
export function formatTrialEnd(epochSeconds: number | null | undefined): string | null {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return null
  const d = new Date(epochSeconds * 1000)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Shared shell so both emails render consistently in every client. Inline
// styles only (email clients strip <style>), no external assets.
function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#10151e;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <p style="font-size:13px;letter-spacing:0.14em;font-weight:bold;color:#2563eb;margin:0 0 20px;">BIDWISE</p>
      <div style="background:#ffffff;border:1px solid #e3e7ec;border-radius:8px;padding:28px;">
        <h1 style="font-size:20px;margin:0 0 16px;">${title}</h1>
        ${bodyHtml}
      </div>
      <p style="font-size:12px;color:#697180;margin:20px 4px 0;">
        Questions? Reply to this email or write to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#2563eb;">${SUPPORT_EMAIL}</a>.
        Manage billing any time from your
        <a href="${SITE_URL}/dashboard" style="color:#2563eb;">dashboard</a>.
      </p>
    </div>
  </body>
</html>`
}

export interface WelcomeEmailInput {
  to: string
  plan: string | null
  /** Stripe sub.trial_end (epoch seconds); null when the sub has no trial. */
  trialEndEpoch: number | null
}

/**
 * Sent on checkout.session.completed. States the trial terms in writing —
 * plan, exactly when the card will be charged, and how to cancel.
 */
export async function sendWelcomeEmail(input: WelcomeEmailInput): Promise<SendEmailResult> {
  const plan = escapeHtml(planDisplayName(input.plan))
  const trialEnd = formatTrialEnd(input.trialEndEpoch)

  const trialBlock = trialEnd
    ? `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
        Your <strong>${TRIAL_DAYS}-day free trial</strong> is active. Your card will not be
        charged until <strong>${escapeHtml(trialEnd)}</strong>. Cancel any time before then
        from your dashboard and you pay nothing.
      </p>`
    : `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
        Your subscription is active.
      </p>`

  const html = emailShell(
    `Welcome to BidWise ${plan}`,
    `${trialBlock}
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
       Every property on the current county auction lists is already analyzed —
       deal score, comps, and a recommended max bid are waiting for you.
     </p>
     <p style="margin:22px 0 0;">
       <a href="${SITE_URL}/dashboard"
          style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:6px;">
         Open your dashboard
       </a>
     </p>`,
  )

  return sendEmail({
    to: input.to,
    subject: trialEnd
      ? `Welcome to BidWise — your ${TRIAL_DAYS}-day trial is active`
      : 'Welcome to BidWise',
    html,
  })
}

export interface TrialEndingEmailInput {
  to: string
  plan: string | null
  /** Stripe sub.trial_end (epoch seconds). */
  trialEndEpoch: number | null
}

/**
 * Sent on customer.subscription.trial_will_end (Stripe fires ~3 days before
 * the trial ends). The one email that prevents "surprise charge" disputes.
 */
export async function sendTrialEndingEmail(input: TrialEndingEmailInput): Promise<SendEmailResult> {
  const plan = escapeHtml(planDisplayName(input.plan))
  const trialEnd = formatTrialEnd(input.trialEndEpoch)
  const whenCopy = trialEnd ? `on <strong>${escapeHtml(trialEnd)}</strong>` : 'in about 3 days'

  const html = emailShell(
    'Your BidWise trial ends soon',
    `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
       Heads up — your ${TRIAL_DAYS}-day free trial of <strong>BidWise ${plan}</strong> ends
       ${whenCopy}, and your card will be charged then.
     </p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
       Want to keep your deal scores, comps, and max-bid numbers through the next
       auction? Do nothing — your plan continues automatically.
     </p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
       Not ready? Cancel before then from your dashboard billing settings and
       you won't be charged.
     </p>
     <p style="margin:22px 0 0;">
       <a href="${SITE_URL}/dashboard"
          style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:6px;">
         Manage my plan
       </a>
     </p>`,
  )

  return sendEmail({
    to: input.to,
    subject: `Your BidWise trial ends soon — card charged ${trialEnd ?? 'in ~3 days'}`,
    html,
  })
}
