import { supabase } from './supabase'
import type {
  LeadPipelineRecord,
  LeadStage,
  OffMarketLead,
  OffMarketLeadSummary,
  Watchlist,
  WatchlistCriteria,
} from './types'

const LEAD_SUMMARY_COLUMNS =
  'id, address, city, state, zip_code, county, estimated_equity, owner_type, years_owned, open_liens, foreclosure_status, equity_tier, deal_score, deal_type, distress_signals, propstream_found, created_at'

const LEAD_PIPELINE_COLUMNS =
  'id, user_id, lead_id, created_at, updated_at, stage, notes'

export async function fetchLeads(): Promise<OffMarketLeadSummary[]> {
  const { data, error } = await supabase
    .from('off_market_leads')
    .select(LEAD_SUMMARY_COLUMNS)
    .order('deal_score', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as OffMarketLeadSummary[]
}

// Resolve the signed-in user's id from the Supabase session. Used to scope
// off_market_leads reads/writes by owner (defense-in-depth on top of RLS).
async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) throw new Error('Not authenticated')
  return userId
}

export async function fetchLead(id: string): Promise<OffMarketLead | null> {
  const userId = await currentUserId()
  const { data, error } = await supabase
    .from('off_market_leads')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as OffMarketLead | null) ?? null
}

export async function fetchLeadPipelineEntries(
  userId: string
): Promise<LeadPipelineRecord[]> {
  const { data, error } = await supabase
    .from('lead_pipeline')
    .select(LEAD_PIPELINE_COLUMNS)
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as LeadPipelineRecord[]
}

// Joined fetch: pulls each lead_pipeline row plus a summary of the linked
// off_market_lead, so the Pipeline tab can render cards without a second query.
export async function fetchLeadPipelineWithLead(
  userId: string
): Promise<LeadPipelineRecord[]> {
  const { data, error } = await supabase
    .from('lead_pipeline')
    .select(
      `id, user_id, lead_id, stage, notes, created_at, updated_at,
       off_market_leads ( ${LEAD_SUMMARY_COLUMNS} )`
    )
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => {
    const joined = row as unknown as LeadPipelineRecord & {
      off_market_leads: OffMarketLeadSummary | null
    }
    return {
      id: joined.id,
      user_id: joined.user_id,
      lead_id: joined.lead_id,
      stage: joined.stage,
      notes: joined.notes,
      created_at: joined.created_at,
      updated_at: joined.updated_at,
      lead: joined.off_market_leads ?? undefined,
    }
  })
}

export async function updateLeadPipelineStage(
  recordId: string,
  stage: LeadStage
): Promise<void> {
  const { error } = await supabase
    .from('lead_pipeline')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', recordId)
  if (error) throw error
}

export async function removeLeadPipelineEntry(recordId: string): Promise<void> {
  const { error } = await supabase
    .from('lead_pipeline')
    .delete()
    .eq('id', recordId)
  if (error) throw error
}

export async function addLeadToPipeline(
  userId: string,
  leadId: string,
  stage: LeadStage = 'qualified'
): Promise<LeadPipelineRecord> {
  const { data, error } = await supabase
    .from('lead_pipeline')
    .upsert(
      { user_id: userId, lead_id: leadId, stage },
      { onConflict: 'user_id,lead_id' }
    )
    .select(LEAD_PIPELINE_COLUMNS)
    .single()
  if (error) throw error
  return data as LeadPipelineRecord
}

export async function removeLeadFromPipeline(
  userId: string,
  leadId: string
): Promise<void> {
  const { error } = await supabase
    .from('lead_pipeline')
    .delete()
    .eq('user_id', userId)
    .eq('lead_id', leadId)
  if (error) throw error
}

export async function updateLeadAIBrief(
  leadId: string,
  brief: string
): Promise<void> {
  const userId = await currentUserId()
  const { error } = await supabase
    .from('off_market_leads')
    .update({
      ai_brief: brief,
      ai_brief_generated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .eq('user_id', userId)
  if (error) throw error
}

// ── Watchlists ──────────────────────────────────────────────────────────────

export async function fetchWatchlists(userId: string): Promise<Watchlist[]> {
  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Watchlist[]
}

export interface WatchlistInput {
  name: string
  criteria: WatchlistCriteria
  alert_email: boolean
}

export async function createWatchlist(
  userId: string,
  input: WatchlistInput
): Promise<Watchlist> {
  const { data, error } = await supabase
    .from('watchlists')
    .insert({
      user_id: userId,
      name: input.name || 'My Watchlist',
      criteria: input.criteria,
      alert_email: input.alert_email,
      alert_sms: false,
      is_active: true,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Watchlist
}

export async function setWatchlistActive(
  id: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from('watchlists')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}

export async function deleteWatchlist(id: string): Promise<void> {
  const { error } = await supabase.from('watchlists').delete().eq('id', id)
  if (error) throw error
}

// Client-side criteria matcher — derives a live "matches" count per watchlist
// for the UI. The server-side notify-watchlist-matches edge function applies
// the same criteria when sending email/push alerts.
// Mirrors the criteria fields stored by the web Create form (county,
// equity_min, min_deal_score, deal_types).
export function leadMatchesWatchlist(
  lead: OffMarketLeadSummary,
  c: WatchlistCriteria
): boolean {
  if (c.counties && c.counties.length > 0) {
    const leadCounty = (lead.county ?? '').toLowerCase()
    if (!c.counties.some((x: string) => x.toLowerCase() === leadCounty)) return false
  }
  if (c.equity_min != null) {
    if ((lead.estimated_equity ?? -Infinity) < c.equity_min) return false
  }
  if (c.min_deal_score != null) {
    if ((lead.deal_score ?? -Infinity) < c.min_deal_score) return false
  }
  if (c.deal_types && c.deal_types.length > 0) {
    if (!lead.deal_type || !c.deal_types.includes(lead.deal_type)) return false
  }
  if (c.owner_types && c.owner_types.length > 0) {
    if (!lead.owner_type || !c.owner_types.includes(lead.owner_type)) return false
  }
  if (c.max_open_liens != null) {
    if ((lead.open_liens ?? 0) > c.max_open_liens) return false
  }
  if (c.min_years_owned != null) {
    if ((lead.years_owned ?? 0) < c.min_years_owned) return false
  }
  if (c.distress_signals && c.distress_signals.length > 0) {
    const signals = lead.distress_signals ?? []
    if (!c.distress_signals.every((s: string) => signals.includes(s as never))) return false
  }
  return true
}
