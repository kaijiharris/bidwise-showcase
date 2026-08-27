// Transactional email via Resend — the one email dependency in the app.
//
// Fail-open by design (same philosophy as lib/rate-limit.ts): when
// RESEND_API_KEY / EMAIL_FROM are not configured, sendEmail() no-ops with a
// warning instead of breaking the calling flow. Email here is a notification
// convenience, never a correctness dependency — callers must treat a failed
// send as non-fatal.

import { Resend } from 'resend'

export interface EmailAttachment {
  filename: string
  /** Raw file bytes — the Resend SDK accepts a Buffer directly. */
  content: Buffer
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  attachments?: EmailAttachment[]
}

export type SendEmailResult = { ok: boolean }

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

/**
 * Send one email. NEVER throws: returns { ok: false } (and logs) on any
 * failure, { ok: true } on success. No-op when Resend env vars are unset so
 * email is a deploy-time switch, not a code release.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!emailConfigured()) {
    console.warn(
      `[email] RESEND_API_KEY / EMAIL_FROM not configured — skipping "${input.subject}"`,
    )
    return { ok: false }
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map(a => ({
              filename: a.filename,
              content: a.content,
            })),
          }
        : {}),
    })
    if (error) {
      console.error(`[email] send failed for "${input.subject}":`, error)
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error(`[email] send threw for "${input.subject}":`, err)
    return { ok: false }
  }
}

/** Escape user-supplied strings before interpolating into email HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
