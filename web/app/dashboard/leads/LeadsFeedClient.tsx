'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { OffMarketLead, OffMarketLeadSummary, EquityTier, EQUITY_TIER_COLORS, EQUITY_TIER_LABELS, DEAL_TYPE_LABELS, DISTRESS_SIGNAL_DISPLAY, LeadStage } from '@/types/off-market'
import { Landmark, MapPin, Tag, Activity, Clock, Plus, Check, Upload as UploadIcon, X, BookmarkPlus, Lock } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CsvUploadModal from './CsvUploadModal'

type EquityFilter = 'all' | EquityTier
type SafeOffMarketLeadSummary = OffMarketLeadSummary & {
  locked?: boolean
  user_plan?: 'starter' | 'pro' | 'expert' | 'none'
}

const EQUITY_FILTERS: { value: EquityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'HIGH_EQUITY', label: EQUITY_TIER_LABELS.HIGH_EQUITY },
  { value: 'MED_EQUITY', label: EQUITY_TIER_LABELS.MED_EQUITY },
  { value: 'LOW_EQUITY', label: EQUITY_TIER_LABELS.LOW_EQUITY },
]

export default function LeadsFeedClient({
  effectivePlan = 'starter',
  isAdminUser = false,
}: {
  effectivePlan?: 'starter' | 'pro' | 'expert'
  isAdminUser?: boolean
}) {
  const router = useRouter()
  const [leads, setLeads] = useState<SafeOffMarketLeadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [pipelineMap, setPipelineMap] = useState<Record<string, LeadStage>>({})
  // Admin status is server-authoritative (passed in via `isAdminUser`); it never
  // changes client-side, so it's a plain const rather than state.
  const isAdmin = isAdminUser
  const [showUpload, setShowUpload] = useState(false)
  const [equityFilter, setEquityFilter] = useState<EquityFilter>('all')
  const [countyFilter, setCountyFilter] = useState<string | null>(null)
  const [cityFilter, setCityFilter] = useState<string | null>(null)

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)

    // Admin status comes from the server-provided `isAdminUser` prop (role +
    // ADMIN_EMAILS env). No client-side admin allowlist — it would ship to
    // every browser and drift from the server source of truth.

    if (effectivePlan === 'starter' && !isAdminUser) {
      setLeads([])
      setPipelineMap({})
      setLoading(false)
      return
    }

    const { data: leadsData } = await supabase
      .from('visible_off_market_leads_safe')
      .select('id, address, city, state, zip_code, county, estimated_equity, owner_type, years_owned, open_liens, foreclosure_status, equity_tier, deal_score, deal_type, distress_signals, propstream_found, created_at, locked, user_plan')
      .order('deal_score', { ascending: false })

    if (leadsData) {
      const parsedLeads = leadsData.map(l => ({
        ...l,
        distress_signals: Array.isArray(l.distress_signals) ? l.distress_signals : []
      }))
      setLeads(parsedLeads as SafeOffMarketLeadSummary[])
    }

    const { data: pipelineData } = await supabase
      .from('lead_pipeline')
      .select('lead_id, stage')

    if (pipelineData) {
      const map: Record<string, LeadStage> = {}
      pipelineData.forEach(p => { map[p.lead_id] = p.stage as LeadStage })
      setPipelineMap(map)
    }

    setLoading(false)
  }, [effectivePlan, isAdminUser, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (equityFilter !== 'all' && (l.equity_tier ?? 'UNKNOWN') !== equityFilter) return false
      if (countyFilter && (l.county ?? '').toLowerCase() !== countyFilter.toLowerCase()) return false
      if (cityFilter && (l.city ?? '').toLowerCase() !== cityFilter.toLowerCase()) return false
      return true
    })
  }, [leads, equityFilter, countyFilter, cityFilter])

  async function unlockLead(lead: SafeOffMarketLeadSummary) {
    if (effectivePlan === 'starter' && !isAdmin) {
      router.push('/pricing')
      return
    }

    const response = await fetch('/api/unlocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: 'off_market_lead',
        contentId: lead.id,
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.unlocked) {
      window.alert(result?.message || 'Unable to unlock this lead.')
      return
    }
    await loadData()
  }

  async function togglePipeline(lead: SafeOffMarketLeadSummary) {
    if (lead.locked) {
      window.alert('Unlock this off-market lead before adding it to your pipeline.')
      return
    }
    const isTracked = !!pipelineMap[lead.id]
    
    if (isTracked) {
      // Remove from pipeline
      await supabase.from('lead_pipeline').delete().eq('lead_id', lead.id)
      setPipelineMap(prev => {
        const next = { ...prev }
        delete next[lead.id]
        return next
      })
    } else {
      // Add to pipeline
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      
      await supabase.from('lead_pipeline').insert({
        user_id: user.id,
        lead_id: lead.id,
        stage: 'new',
        activity_log: [{ at: new Date().toISOString(), action: 'added', to: 'new' }]
      })
      setPipelineMap(prev => ({ ...prev, [lead.id]: 'new' }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500 dark:text-slate-400">
        <Activity className="animate-spin mr-2" size={16} /> Loading BidWise Leads...
      </div>
    )
  }

  if (leads.length === 0) {
    if (effectivePlan === 'starter' && !isAdmin) {
      return (
        <UpgradePrompt
          title="Upgrade to View Off-Market Leads"
          body="Off-market leads, owner signals, and AI Intel Briefs are available on Pro and Expert plans."
          cta="Compare Plans"
        />
      )
    }

    return (
      <div className="flex flex-col items-center justify-center py-24 text-center bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm">
        <Landmark size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white">No Off-Market Leads</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
          Run the BidWise Deal Engine to ingest off-market properties and view them here.
        </p>
        {isAdmin && (
          <button 
            onClick={() => setShowUpload(true)}
            className="mt-6 flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
          >
            <UploadIcon size={14} /> Upload Deal Feed
          </button>
        )}
        
        {showUpload && (
          <CsvUploadModal 
            onClose={() => setShowUpload(false)} 
            onSuccess={() => { setShowUpload(false); loadData() }} 
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">BidWise Leads</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Exclusive off-market opportunities, automatically scored and ranked.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold px-3 py-1.5 bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg shadow-sm text-slate-600 dark:text-slate-300">
            {filteredLeads.length}
            {filteredLeads.length !== leads.length ? ` of ${leads.length}` : ''} Deals
          </div>
          {isAdmin && (
            <button 
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shadow-sm"
            >
              <UploadIcon size={14} /> Upload CSV
            </button>
          )}
        </div>
      </div>

      {showUpload && (
        <CsvUploadModal 
          onClose={() => setShowUpload(false)} 
          onSuccess={() => { setShowUpload(false); window.location.reload() }} 
        />
      )}

      <LeadFilters
        leads={leads}
        equityFilter={equityFilter}
        setEquityFilter={setEquityFilter}
        countyFilter={countyFilter}
        setCountyFilter={(c) => {
          setCountyFilter(c)
          setCityFilter(null)
        }}
        cityFilter={cityFilter}
        setCityFilter={setCityFilter}
        onSaveAsWatchlist={() => {
          const params = new URLSearchParams({ openModal: '1' })
          if (countyFilter) params.set('prefillCounty', countyFilter)
          if (cityFilter) params.set('prefillCity', cityFilter)
          if (equityFilter !== 'all') params.set('prefillEquity', equityFilter)
          router.push(`/dashboard/leads/watchlists?${params.toString()}`)
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredLeads.map(lead => {
          const tierClass = EQUITY_TIER_COLORS[lead.equity_tier] || EQUITY_TIER_COLORS['UNKNOWN']
          const isTracked = !!pipelineMap[lead.id]
          const isLocked = !!lead.locked

          return (
            <div key={lead.id} className={`flex flex-col bg-white dark:bg-navy-800 border rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden group ${isLocked ? 'border-amber-200 dark:border-amber-800/50' : 'border-slate-200 dark:border-white/10'}`}>
              {/* Header: Score & Equity */}
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-start justify-between bg-slate-50/50 dark:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2
                    ${lead.deal_score >= 80 ? 'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400' : 
                      lead.deal_score >= 60 ? 'border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400' : 
                      'border-red-500 text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400'}`}
                  >
                    {lead.deal_score}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Deal Score</div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-0.5 flex items-center gap-1.5">
                      <Tag size={10} />
                      {DEAL_TYPE_LABELS[lead.deal_type] || 'Unclassified'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {isLocked && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50">
                      <Lock size={10} /> Locked
                    </span>
                  )}
                  <div className={`px-2 py-1 rounded-md text-[10px] font-bold border ${tierClass.bg} ${tierClass.text} ${tierClass.border}`}>
                    {EQUITY_TIER_LABELS[lead.equity_tier] || 'Unknown'}
                  </div>
                </div>
              </div>

              {/* Body: Address & Data */}
              <div className="p-4 flex-1">
                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white leading-tight">
                  {lead.address}
                </h3>
                <div className="flex items-center gap-1 text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5">
                  <MapPin size={11} /> {lead.city}, {lead.state} {lead.zip_code}
                </div>

                {/* Distress Signals */}
                <div className={`flex flex-wrap gap-1.5 mt-4 ${isLocked ? 'blur-[2px] select-none' : ''}`}>
                  {(lead.distress_signals || []).length > 0 ? (lead.distress_signals || []).map((sig, idx) => {
                    const display = DISTRESS_SIGNAL_DISPLAY[sig as keyof typeof DISTRESS_SIGNAL_DISPLAY]
                    if (!display) return null
                    return (
                      <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                        {display.icon} {display.label}
                      </span>
                    )
                  }) : isLocked ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                      Unlock to reveal signals
                    </span>
                  ) : null}
                </div>

                <div className={`grid grid-cols-2 gap-y-3 gap-x-4 mt-5 ${isLocked ? 'blur-[2px] select-none' : ''}`}>
                  <div>
                    <div className="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Est. Equity</div>
                    <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                      {lead.estimated_equity != null ? `$${lead.estimated_equity.toLocaleString()}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Owner</div>
                    <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {lead.owner_type || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Years Owned</div>
                    <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                      {lead.years_owned != null ? lead.years_owned : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Open Liens</div>
                    <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      {lead.open_liens != null ? lead.open_liens : '—'}
                      {(lead.open_liens || 0) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="px-4 py-3 border-t border-slate-100 dark:border-white/5 flex gap-2">
                <button
                  onClick={() => togglePipeline(lead)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all border ${
                    isLocked
                      ? 'bg-slate-50 dark:bg-white/5 text-slate-400 border-slate-200 dark:border-white/10 cursor-not-allowed'
                      : isTracked 
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/40' 
                      : 'bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  {isLocked ? <><Lock size={12} /> Unlock First</> : isTracked ? <><Check size={12} /> In Pipeline</> : <><Plus size={12} /> Pipeline</>}
                </button>
                {isLocked ? (
                  <button
                    onClick={() => unlockLead(lead)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11.5px] font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
                  >
                    <Lock size={12} /> Unlock Brief
                  </button>
                ) : (
                  <Link
                    href={`/dashboard/leads/intel/${lead.id}`}
                    className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-[11.5px] font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
                  >
                    View Brief
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UpgradePrompt({
  title,
  body,
  cta,
}: {
  title: string
  body: string
  cta: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center bg-white dark:bg-navy-800 border border-amber-200 dark:border-amber-800/50 rounded-xl shadow-sm">
      <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center mb-4">
        <Lock size={24} className="text-amber-500" />
      </div>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
        {body}
      </p>
      <Link
        href="/pricing"
        className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
      >
        <Lock size={13} /> {cta}
      </Link>
    </div>
  )
}

function LeadFilters({
  leads,
  equityFilter,
  setEquityFilter,
  countyFilter,
  setCountyFilter,
  cityFilter,
  setCityFilter,
  onSaveAsWatchlist,
}: {
  leads: OffMarketLeadSummary[]
  equityFilter: EquityFilter
  setEquityFilter: (v: EquityFilter) => void
  countyFilter: string | null
  setCountyFilter: (v: string | null) => void
  cityFilter: string | null
  setCityFilter: (v: string | null) => void
  onSaveAsWatchlist: () => void
}) {
  const counties = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of leads) {
      const c = (l.county ?? '').trim()
      if (c) seen.set(c.toLowerCase(), c)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [leads])

  const cities = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of leads) {
      if (countyFilter && (l.county ?? '').toLowerCase() !== countyFilter.toLowerCase()) continue
      const c = (l.city ?? '').trim()
      if (c) seen.set(c.toLowerCase(), c)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [leads, countyFilter])

  const activeCount =
    (equityFilter !== 'all' ? 1 : 0) + (countyFilter ? 1 : 0) + (cityFilter ? 1 : 0)

  return (
    <div className="space-y-2 bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl p-3 shadow-sm">
      <FilterChipRow label="Equity">
        {EQUITY_FILTERS.map((opt) => (
          <FilterChip
            key={opt.value}
            label={opt.label}
            active={opt.value === equityFilter}
            onClick={() => setEquityFilter(opt.value)}
          />
        ))}
      </FilterChipRow>
      {counties.length > 0 && (
        <FilterChipRow label="County">
          <FilterChip
            label="All"
            active={countyFilter === null}
            onClick={() => setCountyFilter(null)}
          />
          {counties.map((c) => (
            <FilterChip
              key={c}
              label={c}
              active={countyFilter?.toLowerCase() === c.toLowerCase()}
              onClick={() => setCountyFilter(c)}
            />
          ))}
        </FilterChipRow>
      )}
      {cities.length > 0 && (
        <FilterChipRow label="City">
          <FilterChip
            label="All"
            active={cityFilter === null}
            onClick={() => setCityFilter(null)}
          />
          {cities.map((c) => (
            <FilterChip
              key={c}
              label={c}
              active={cityFilter?.toLowerCase() === c.toLowerCase()}
              onClick={() => setCityFilter(c)}
            />
          ))}
        </FilterChipRow>
      )}
      {activeCount > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => {
              setEquityFilter('all')
              setCountyFilter(null)
              setCityFilter(null)
            }}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
          >
            <X size={10} /> Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </button>
          <button
            onClick={onSaveAsWatchlist}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          >
            <BookmarkPlus size={11} /> Save as Watchlist
          </button>
        </div>
      )}
    </div>
  )
}

function FilterChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 w-14 text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
        active
          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/50'
          : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  )
}
