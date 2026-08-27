'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { OffMarketLead } from '@/types/off-market'
import { ArrowLeft, Brain, Cpu, Clock, Activity, Target, Landmark, Tag, MapPin, Lock } from 'lucide-react'

type SafeOffMarketLead = OffMarketLead & {
  locked?: boolean
  user_plan?: 'starter' | 'pro' | 'expert' | 'none'
}

export default function IntelBriefClient() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  
  const [lead, setLead] = useState<SafeOffMarketLead | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function loadLead() {
      const { data } = await supabase
        .from('visible_off_market_leads_safe')
        .select('*')
        .eq('id', id)
        .single()
        
      if (data) {
        setLead({
          ...data,
          distress_signals: Array.isArray(data.distress_signals) ? data.distress_signals : []
        } as SafeOffMarketLead)
      }
      setLoading(false)
    }
    loadLead()
  }, [id, supabase])

  async function unlockLead() {
    const response = await fetch('/api/unlocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: 'off_market_lead',
        contentId: id,
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.unlocked) {
      window.alert(result?.message || 'Unable to unlock this lead.')
      return
    }

    const { data } = await supabase
      .from('visible_off_market_leads_safe')
      .select('*')
      .eq('id', id)
      .single()

    if (data) {
      setLead({
        ...data,
        distress_signals: Array.isArray(data.distress_signals) ? data.distress_signals : []
      } as SafeOffMarketLead)
    }
  }

  // Real AI brief generation via the Supabase edge function `generate-brief`.
  // The function takes the lead data in the request body, runs the Gemini
  // synthesis server-side (the prompt + model key never touch the client), and
  // returns { brief } in the response. We render it immediately, then best-effort
  // persist it to the row so it survives a reload (RLS scopes the write to the
  // owner). This mirrors the working mobile flow — the function itself does not
  // fetch the lead or write the brief.
  async function generateBrief() {
    if (!lead || lead.locked) {
      window.alert('Unlock this off-market lead before generating an Intel Brief.')
      return
    }
    setGenerating(true)

    try {
      const { data, error: fnError } = await supabase.functions.invoke<{ brief: string }>(
        'generate-brief',
        { body: { lead } },
      )
      if (fnError) throw fnError

      const brief = data?.brief?.trim()
      if (!brief) throw new Error('The brief came back empty. Please try again.')

      const generatedAt = new Date().toISOString()

      // Show it right away.
      setLead({ ...lead, ai_brief: brief, ai_brief_generated_at: generatedAt })

      // Best-effort persist so the brief is there on the next visit. A failure
      // here (e.g. RLS) must not break the brief the user is already reading.
      const { error: persistErr } = await supabase
        .from('off_market_leads')
        .update({ ai_brief: brief, ai_brief_generated_at: generatedAt })
        .eq('id', id)
      if (persistErr) {
        console.warn('[generate-brief] persist failed (non-fatal):', persistErr.message)
      }
    } catch (err) {
      console.error('[generate-brief] failed:', err)
      window.alert('We could not generate the brief right now. Please try again in a moment.')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-slate-500 dark:text-slate-400">
        <Activity className="animate-spin mb-4 text-emerald-500" size={24} />
        <span className="text-sm font-semibold">Loading Intelligence Brief...</span>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Lead Not Found</h3>
        <button onClick={() => router.push('/dashboard/leads')} className="mt-4 text-sm text-emerald-600 hover:text-emerald-700">Return to Leads</button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button 
        onClick={() => router.push('/dashboard/leads')}
        className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
      >
        <ArrowLeft size={14} /> Back to Leads
      </button>

      <div className="bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                  {(lead.county || 'UNKNOWN').toUpperCase()} COUNTY
                </span>
                {lead.locked && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <Lock size={10} /> LOCKED
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  lead.deal_score >= 80 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                }`}>
                  SCORE: {lead.deal_score}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{lead.address}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <MapPin size={14} /> {lead.city}, {lead.state} {lead.zip_code}
              </p>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={lead.locked ? unlockLead : generateBrief}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                {lead.locked ? <Lock size={14} /> : generating ? <Cpu size={14} className="animate-spin" /> : <Brain size={14} />}
                {lead.locked ? 'Unlock Brief' : generating ? 'Analyzing...' : lead.ai_brief ? 'Regenerate Brief' : 'Generate Brief'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Executive Summary Section */}
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-4">
              <Target size={16} className="text-emerald-500" /> Executive Summary
            </h2>
            
            {lead.ai_brief ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {lead.ai_brief.split('\n').map((para, i) => {
                  // Escape HTML first so LLM output (and user-supplied address /
                  // owner fields interpolated into the brief) cannot inject tags.
                  const escaped = para.replace(/[&<>"']/g, (c) => (
                    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
                  ))
                  const html = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  return <p key={i} dangerouslySetInnerHTML={{ __html: html }} className="mb-4 text-slate-600 dark:text-slate-300 leading-relaxed" />
                })}
                <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-6 pt-4 border-t border-slate-100 dark:border-white/5">
                  <Clock size={10} /> Generated on {new Date(lead.ai_brief_generated_at!).toLocaleString()}
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 leading-relaxed">
                  AI-generated estimate from public-records data — not an appraisal or financial, legal, or
                  investment advice. ARV, rehab, and max-bid figures are automated approximations; verify
                  independently before bidding.
                </p>
              </div>
            ) : (
              <div className="p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl text-center bg-slate-50 dark:bg-white/[0.01]">
                {lead.locked ? (
                  <Lock size={32} className="mx-auto text-amber-400 dark:text-amber-500 mb-3" />
                ) : (
                  <Brain size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                )}
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                  {lead.locked ? 'Intel Brief Locked' : 'No Intelligence Brief Generated Yet'}
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {lead.locked
                    ? 'Spend one off-market unlock to reveal the brief and owner details.'
                    : 'Click "Generate Brief" to synthesize the data into an actionable narrative.'}
                </p>
              </div>
            )}
          </div>

          {/* New Details Section */}
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-4 pb-2 border-b border-slate-100 dark:border-white/5">
                <Tag size={16} className="text-slate-400" /> Property Details
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Year Built</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{lead.year_built || 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Building Sqft</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {lead.building_sqft ? `${lead.building_sqft.toLocaleString()} sqft` : 'Unknown'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Beds / Baths</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {lead.beds || '-'} Bed / {lead.baths || '-'} Bath
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Est. Value</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {lead.est_value ? `$${lead.est_value.toLocaleString()}` : 'Unknown'}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-4 pb-2 border-b border-slate-100 dark:border-white/5">
                <MapPin size={16} className="text-slate-400" /> Owner & Mailing
              </h2>
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Owner Name</div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{lead.owner_name || lead.owner_type || 'Unknown'}</div>
                </div>
                {(lead.owner_phone || lead.owner_email) && (
                  <div className="flex gap-4">
                    {lead.owner_phone && (
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Phone</div>
                        <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{lead.owner_phone}</div>
                      </div>
                    )}
                    {lead.owner_email && (
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Email</div>
                        <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{lead.owner_email}</div>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Mailing Address</div>
                  {lead.mailing_address ? (
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {lead.mailing_address}<br/>
                      {lead.mailing_city}, {lead.mailing_state} {lead.mailing_zip}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 italic">Same as property address</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
