'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Watchlist, DealType, DistressSignal } from '@/types/off-market'
import { Eye, Plus, Check, MapPin, Tag, Activity, Settings2, Trash2, Mail, Lock } from 'lucide-react'

export default function WatchlistClient({
  effectivePlan = 'starter',
}: {
  effectivePlan?: 'starter' | 'pro' | 'expert'
}) {
  const searchParams = useSearchParams()
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const supabase = createClient()

  // Form State
  const [name, setName] = useState('')
  const [county, setCounty] = useState('')
  const [minEquity, setMinEquity] = useState('')
  const [minScore, setMinScore] = useState('60')
  const [dealType, setDealType] = useState<DealType | 'all'>('all')
  const [alertEmail, setAlertEmail] = useState(true)

  useEffect(() => {
    if (effectivePlan === 'starter') {
      setLoading(false)
      return
    }
    loadWatchlists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Prefill from "Save as Watchlist" coming from the Leads feed.
  useEffect(() => {
    if (searchParams.get('openModal') !== '1') return
    const c = searchParams.get('prefillCounty')
    if (c) setCounty(c)
    const eq = searchParams.get('prefillEquity')
    if (eq === 'HIGH_EQUITY') setMinEquity('100000')
    else if (eq === 'MED_EQUITY') setMinEquity('30000')
    else if (eq === 'LOW_EQUITY') setMinEquity('0')
    setShowModal(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function loadWatchlists() {
    if (effectivePlan === 'starter') {
      setWatchlists([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase
        .from('watchlists')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      
      if (data) setWatchlists(data as Watchlist[])
    }
    setLoading(false)
  }

  async function handleCreate() {
    if (effectivePlan === 'starter') return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const criteria: {
      counties?: string[]
      equity_min?: number
      min_deal_score?: number
      deal_types?: string[]
    } = {}
    if (county) criteria.counties = [county.toLowerCase().trim()]
    if (minEquity) criteria.equity_min = parseInt(minEquity)
    if (minScore) criteria.min_deal_score = parseInt(minScore)
    if (dealType !== 'all') criteria.deal_types = [dealType]

    await supabase.from('watchlists').insert({
      user_id: user.id,
      name: name || 'My Watchlist',
      criteria,
      alert_email: alertEmail,
      alert_sms: false,
      is_active: true
    })

    setShowModal(false)
    setName('')
    setCounty('')
    setMinEquity('')
    setDealType('all')
    loadWatchlists()
  }

  async function handleDelete(id: string) {
    await supabase.from('watchlists').delete().eq('id', id)
    loadWatchlists()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('watchlists').update({ is_active: !current }).eq('id', id)
    loadWatchlists()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500 dark:text-slate-400">
        <Activity className="animate-spin mr-2" size={16} /> Loading Watchlists...
      </div>
    )
  }

  if (effectivePlan === 'starter') {
    return (
      <UpgradePrompt
        title="Upgrade to Use Watchlists"
        body="Watchlists and email match alerts are included with Pro and Expert plans."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Watchlists</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Automated email alerts for highly specific off-market matches.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shadow-sm"
        >
          <Plus size={14} /> New Watchlist
        </button>
      </div>

      {watchlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm">
          <div className="w-16 h-16 bg-slate-50 dark:bg-navy-900 rounded-full flex items-center justify-center mb-4">
            <Eye size={24} className="text-slate-300 dark:text-slate-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white">No Watchlists Yet</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            Create a watchlist to get notified automatically when a new off-market property matches your exact criteria.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {watchlists.map(wl => (
            <div key={wl.id} className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm relative overflow-hidden flex flex-col">
              {/* Status Bar */}
              <div className={`absolute top-0 left-0 w-1 h-full ${wl.is_active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
              
              <div className="flex items-start justify-between mb-3 ml-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{wl.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                      <Mail size={10} /> {wl.alert_email ? 'Email On' : 'Silent'}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                      wl.is_active 
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400'
                    }`}>
                      {wl.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-2 ml-2 mt-2">
                <div className="text-[11px] flex justify-between border-b border-slate-100 dark:border-white/5 pb-1.5">
                  <span className="text-slate-500 dark:text-slate-400">Target County</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                    {wl.criteria.counties ? wl.criteria.counties[0] : 'Any'}
                  </span>
                </div>
                <div className="text-[11px] flex justify-between border-b border-slate-100 dark:border-white/5 pb-1.5">
                  <span className="text-slate-500 dark:text-slate-400">Min. Equity</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {wl.criteria.equity_min ? `$${wl.criteria.equity_min.toLocaleString()}` : 'Any'}
                  </span>
                </div>
                <div className="text-[11px] flex justify-between border-b border-slate-100 dark:border-white/5 pb-1.5">
                  <span className="text-slate-500 dark:text-slate-400">Min. Deal Score</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {wl.criteria.min_deal_score || 'Any'}
                  </span>
                </div>
                <div className="text-[11px] flex justify-between pb-1.5">
                  <span className="text-slate-500 dark:text-slate-400">Deal Strategy</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                    {wl.criteria.deal_types ? wl.criteria.deal_types[0].replace('_', ' ') : 'Any'}
                  </span>
                </div>
              </div>

              <div className="ml-2 mt-4 pt-3 border-t border-slate-100 dark:border-white/5 flex gap-2">
                <button 
                  onClick={() => toggleActive(wl.id, wl.is_active)}
                  className="flex-1 py-1.5 text-[11px] font-semibold bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded transition-colors"
                >
                  {wl.is_active ? 'Pause Alerts' : 'Resume Alerts'}
                </button>
                <button 
                  onClick={() => handleDelete(wl.id)}
                  className="px-3 py-1.5 text-[11px] font-semibold bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-navy-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Eye size={16} className="text-emerald-500" /> Create Watchlist
              </h2>
            </div>
            
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Watchlist Name</label>
                <input 
                  type="text" 
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. High Equity DeKalb"
                  className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Target County</label>
                  <input 
                    type="text" 
                    value={county} onChange={e => setCounty(e.target.value)}
                    placeholder="e.g. DeKalb"
                    className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Min. Equity ($)</label>
                  <input 
                    type="number" 
                    value={minEquity} onChange={e => setMinEquity(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Min. Deal Score</label>
                  <input 
                    type="number" 
                    value={minScore} onChange={e => setMinScore(e.target.value)}
                    placeholder="0-100"
                    className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Deal Strategy</label>
                  <select 
                    value={dealType} onChange={e => setDealType(e.target.value as DealType | 'all')}
                    className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="all">Any Strategy</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="flip">Fix & Flip</option>
                    <option value="rental">Rental</option>
                    <option value="distressed">Distressed</option>
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={alertEmail} 
                    onChange={e => setAlertEmail(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Send email alerts for new matches</span>
                </label>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-navy-800 flex justify-end gap-2">
              <button 
                onClick={() => setShowModal(false)} 
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreate}
                disabled={!name}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                Create Watchlist
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UpgradePrompt({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center bg-white dark:bg-navy-800 border border-amber-200 dark:border-amber-800/50 rounded-xl shadow-sm">
      <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center mb-4">
        <Lock size={24} className="text-amber-500" />
      </div>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{body}</p>
      <Link
        href="/pricing"
        className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
      >
        <Lock size={13} /> Compare Plans
      </Link>
    </div>
  )
}
