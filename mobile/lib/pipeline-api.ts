import { supabase } from './supabase'
import type { NormalizedProperty, PipelineDeal, PipelineStatus } from './types'

const COLUMNS =
  'id, user_id, county, parcel_id, address, city, zip, auction_date, roi, deal_score, status, notes, added_at, updated_at'

export async function fetchPipeline(userId: string): Promise<PipelineDeal[]> {
  const { data, error } = await supabase
    .from('auction_pipeline')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('added_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PipelineDeal[]
}

export async function addToPipeline(
  userId: string,
  prop: NormalizedProperty,
  status: PipelineStatus = 'watchlist'
): Promise<PipelineDeal> {
  const row = {
    user_id: userId,
    county: prop.county,
    parcel_id: prop.taxId || `${prop.county}-${prop.id}`,
    address: prop.addr,
    city: prop.city || null,
    zip: prop.zip || null,
    auction_date: prop.auctionDate,
    roi: prop.roi,
    deal_score: prop.score,
    status,
  }
  const { data, error } = await supabase
    .from('auction_pipeline')
    .upsert(row, { onConflict: 'user_id,parcel_id' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as PipelineDeal
}

export async function updatePipelineStatus(
  id: string,
  status: PipelineStatus
): Promise<PipelineDeal> {
  const { data, error } = await supabase
    .from('auction_pipeline')
    .update({ status })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as PipelineDeal
}

export async function updatePipelineNotes(id: string, notes: string | null): Promise<void> {
  const { error } = await supabase
    .from('auction_pipeline')
    .update({ notes })
    .eq('id', id)
  if (error) throw error
}

export async function removeFromPipeline(id: string): Promise<void> {
  const { error } = await supabase.from('auction_pipeline').delete().eq('id', id)
  if (error) throw error
}
