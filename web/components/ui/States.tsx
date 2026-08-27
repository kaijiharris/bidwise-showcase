import { AlertCircle, Inbox, CheckCircle, Loader2, Lock } from 'lucide-react'
import Link from 'next/link'

// ── Loading ───────────────────────────────────────────────────────────────────
export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Loader2 size={28} className="text-emerald-400 animate-spin" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div className="glass-card p-5 animate-pulse space-y-3">
      <div className="h-3 bg-white/8 rounded-full w-2/3" />
      <div className="h-3 bg-white/5 rounded-full w-1/2" />
      <div className="h-8 bg-white/5 rounded-xl w-full mt-4" />
    </div>
  )
}

// ── Empty ─────────────────────────────────────────────────────────────────────
export function EmptyState({
  title = 'Nothing here yet',
  desc = 'Run your first property analysis to get started.',
  cta,
  ctaHref,
}: {
  title?: string
  desc?: string
  cta?: string
  ctaHref?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <Inbox size={24} className="text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-bold text-white mb-1">{title}</p>
        <p className="text-xs text-slate-500 max-w-xs">{desc}</p>
      </div>
      {cta && ctaHref && (
        <Link
          href={ctaHref}
          className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
        >
          {cta}
        </Link>
      )}
    </div>
  )
}

// ── Error ─────────────────────────────────────────────────────────────────────
export function ErrorState({
  title = 'Something went wrong',
  desc = 'We hit an unexpected error. Please try again.',
  onRetry,
}: {
  title?: string
  desc?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <AlertCircle size={24} className="text-red-400" />
      </div>
      <div>
        <p className="text-sm font-bold text-white mb-1">{title}</p>
        <p className="text-xs text-slate-500 max-w-xs">{desc}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-5 py-2.5 bg-white/8 hover:bg-white/12 text-white text-sm font-bold rounded-xl border border-white/10 transition-all"
        >
          Try again
        </button>
      )}
    </div>
  )
}

// ── Success toast ─────────────────────────────────────────────────────────────
export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-sm text-emerald-300">
      <CheckCircle size={16} className="text-emerald-400 shrink-0" />
      {message}
    </div>
  )
}

// ── Trial expired ─────────────────────────────────────────────────────────────
export function TrialExpiredGate({ feature = 'this feature' }: { feature?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
      <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
        <Lock size={24} className="text-yellow-400" />
      </div>
      <div>
        <p className="text-sm font-bold text-white mb-1">Trial expired</p>
        <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
          Your free trial has ended. Upgrade your plan to continue using {feature}.
        </p>
      </div>
      <Link
        href="/pricing"
        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
      >
        View Membership Plans
      </Link>
    </div>
  )
}

// ── Plan upgrade gate (for locked features) ───────────────────────────────────
export function UpgradeGate({
  feature = 'this feature',
  requiredPlan = 'Pro',
}: {
  feature?: string
  requiredPlan?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
        <Lock size={20} className="text-yellow-400" />
      </div>
      <div>
        <p className="text-sm font-bold text-white mb-1">{requiredPlan} plan required</p>
        <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
          {feature} is available on the {requiredPlan} plan and above.
        </p>
      </div>
      <Link
        href="/pricing"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-navy-900 text-sm font-bold rounded-xl transition-all"
      >
        Upgrade to {requiredPlan}
      </Link>
    </div>
  )
}
