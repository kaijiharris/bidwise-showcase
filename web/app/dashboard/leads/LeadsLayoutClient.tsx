'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart3, Settings, LogOut, FileText, Zap, TrendingUp,
  Landmark, X, Menu, Sparkles, Eye, Briefcase
} from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import UpgradeModal from '@/components/UpgradeModal'
import type { PlanKey } from '@/lib/access'

type SystemPanel = 'settings' | 'directives'

const PLAN_LABELS: Record<PlanKey, string> = { starter: 'Starter', pro: 'Pro', expert: 'Expert' }

export default function LeadsLayoutClient({
  children,
  user,
  effectivePlan = 'starter',
  isAdmin = false,
}: {
  children: React.ReactNode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase auth user passed from server component
  user: any
  effectivePlan?: string
  isAdmin?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<SystemPanel | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const planKey: PlanKey =
    effectivePlan === 'pro' || effectivePlan === 'expert' ? effectivePlan : 'starter'
  const showUpgradeBadge = !isAdmin && planKey !== 'expert'

  function openUpgrade() {
    setActivePanel(null)
    setSidebarOpen(false)
    setUpgradeOpen(true)
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <div className="flex h-screen bg-[#F8F9FA] dark:bg-navy-900 text-slate-800 dark:text-slate-200 overflow-hidden relative">

      {/* MOBILE SIDEBAR OVERLAY */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <aside className={`fixed md:static inset-y-0 left-0 z-50 w-[220px] shrink-0 flex flex-col bg-white dark:bg-navy-800 border-r border-slate-200 dark:border-white/10 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>

        {/* Logo */}
        <div className="px-4 pt-5 pb-4 border-b border-slate-100 dark:border-white/10 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-center shrink-0">
                <Landmark size={15} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-[15px] font-black text-slate-900 dark:text-white tracking-tight">BidWiseAI</span>
            </div>
            <div className="text-[9px] text-slate-500 dark:text-slate-400 font-bold tracking-[0.15em] uppercase pl-[42px]">
              Deal Intelligence
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">

          {/* WORKSPACE */}
          <div className="mb-4">
            <div className="px-2 pb-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">Workspace</div>
            <Link
              href="/dashboard"
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left mb-0.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 border border-transparent"
            >
              <BarChart3 size={13} />
              <span className="flex-1">Dashboard (Auction)</span>
            </Link>
          </div>

          {/* OFF-MARKET */}
          <div className="mb-4">
            <div className="px-2 pb-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">Off-Market</div>
            {[
              { id: 'leads', label: 'BidWise Leads', icon: <Sparkles size={13} />, href: '/dashboard/leads' },
              { id: 'intel', label: 'BidWise Intel', icon: <FileText size={13} />, href: '/dashboard/leads/intel' },
              { id: 'watchlists', label: 'Watchlists', icon: <Eye size={13} />, href: '/dashboard/leads/watchlists' },
              { id: 'deal-desk', label: 'Deal Desk', icon: <Briefcase size={13} />, href: '/dashboard/leads/deal-desk' },
            ].map(item => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left mb-0.5 ${
                    isActive
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 border border-transparent'
                  }`}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                </Link>
              )
            })}
          </div>

          {/* SYSTEM */}
          <div>
            <div className="px-2 pb-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">System</div>
            {[
              { label: 'Settings',   icon: <Settings size={12} />, panel: 'settings' as const },
              { label: 'Directives', icon: <FileText size={12} />, panel: 'directives' as const },
            ].map(item => (
              <button
                key={item.label}
                onClick={() => {
                  setActivePanel(item.panel)
                  setSidebarOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-all text-left mb-0.5"
              >
                {item.icon}{item.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-white/10 space-y-1.5">
          <div className="flex items-center gap-2 px-2.5 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">System Online</span>
          </div>
          {showUpgradeBadge ? (
            <button
              onClick={openUpgrade}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                <Zap size={10} /> Plan: {PLAN_LABELS[planKey]}
              </span>
              <span className="text-[10.5px] font-bold">Upgrade →</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Zap size={10} className="text-blue-400" />
              <span className="font-semibold">
                Plan: {isAdmin ? 'Expert (Admin)' : PLAN_LABELS[planKey]}
              </span>
            </div>
          )}
          <div className="px-2 text-[10px] text-slate-500 dark:text-slate-400 truncate">{user?.email}</div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11.5px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── MAIN AREA ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden w-full">

        {/* TOP BAR */}
        <div className="h-[56px] shrink-0 flex items-center justify-between px-3 md:px-5 bg-white dark:bg-navy-800 border-b border-slate-200 dark:border-white/10 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white p-1">
              <Menu size={20} />
            </button>
            <div className="flex flex-col">
              <span className="text-[13px] font-bold text-slate-800 dark:text-white">BidWise Off-Market</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Exclusive Deal Engine</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>

        {/* PAGE CONTENT */}
        <div className="flex-1 overflow-y-auto p-3 md:p-5">
          {children}
        </div>
      </main>

      {activePanel && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
          style={{ zIndex: 80 }}
          onClick={() => setActivePanel(null)}
        >
          <div
            className="bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-[480px] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {activePanel === 'settings' && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-[15px] font-black text-slate-900 dark:text-white">Settings</h2>
                  <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <div className="space-y-5">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Appearance</div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Theme</span>
                      <ThemeToggle />
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Account</div>
                    <div className="space-y-2">
                      <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mb-0.5">Email</div>
                        <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">{user?.email}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mb-0.5">Plan</div>
                          <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 capitalize">{isAdmin ? 'Expert (Admin)' : effectivePlan}</div>
                        </div>
                        {showUpgradeBadge && (
                          <button
                            onClick={openUpgrade}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-600 dark:text-amber-400 text-[11px] font-bold rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                          >
                            <Zap size={10} /> Upgrade
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Security</div>
                    <div className="space-y-2">
                      <button
                        onClick={async () => {
                          const supabase = createClient()
                          const newPw = prompt('Enter new password (min 8 characters):')
                          if (!newPw || newPw.length < 8) return
                          const { error } = await supabase.auth.updateUser({ password: newPw })
                          if (error) alert('Error: ' + error.message)
                          else { alert('Password updated successfully.'); setActivePanel(null) }
                        }}
                        className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-colors group"
                      >
                        <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">Change Password</span>
                        <span className="text-[11px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">Open</span>
                      </button>
                      <button
                        onClick={() => { setActivePanel(null); handleSignOut() }}
                        className="w-full flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800/50 hover:border-red-300 dark:hover:border-red-700/50 transition-colors"
                      >
                        <span className="text-[12.5px] font-medium text-red-600 dark:text-red-400">Sign Out</span>
                        <LogOut size={13} className="text-red-400 dark:text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activePanel === 'directives' && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-[15px] font-black text-slate-900 dark:text-white">Analysis Directives</h2>
                  <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-5">How BidWise sources, scores, and gates auction and off-market opportunities.</p>
                <div className="space-y-3">
                  {[
                    { icon: <FileText size={14} />, name: 'Source', detail: 'County auction lists and off-market feeds are ingested into reviewed batches before users see them.' },
                    { icon: <Sparkles size={14} />, name: 'Score', detail: 'Deal score, ROI, risk, and confidence fields are calculated from available property and comp data.' },
                    { icon: <TrendingUp size={14} />, name: 'Gate', detail: 'Starter, Pro, and Expert access is enforced by plan, monthly unlock count, and release timing.' },
                  ].map(step => (
                    <div key={step.name} className="flex gap-3 p-3.5 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">{step.icon}</div>
                      <div>
                        <div className="text-[12px] font-bold text-slate-800 dark:text-slate-200 mb-0.5">{step.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{step.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentPlan={planKey}
        isAdmin={!!isAdmin}
      />

    </div>
  )
}
