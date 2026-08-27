'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LeadPipelineRecord, OffMarketLeadSummary, LeadStage, LEAD_STAGE_LABELS } from '@/types/off-market'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { MapPin, Tag, Clock, Activity, Briefcase, Lock } from 'lucide-react'
import Link from 'next/link'

const COLUMNS: LeadStage[] = ['qualified', 'outreach', 'negotiating', 'under_contract']

export default function DealDeskClient({
  effectivePlan = 'starter',
}: {
  effectivePlan?: 'starter' | 'pro' | 'expert'
}) {
  const [pipeline, setPipeline] = useState<Record<string, LeadPipelineRecord[]>>({
    qualified: [],
    outreach: [],
    negotiating: [],
    under_contract: []
  })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function loadPipeline() {
      if (effectivePlan !== 'expert') {
        setLoading(false)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch all pipeline records for this user, including joined lead data
      const { data, error } = await supabase
        .from('lead_pipeline')
        .select(`
          id, user_id, lead_id, stage, notes, updated_at,
          off_market_leads ( id, address, city, state, zip_code, deal_score, equity_tier, deal_type, estimated_equity )
        `)
        .eq('user_id', user.id)

      if (data) {
        const grouped: Record<string, LeadPipelineRecord[]> = {
          qualified: [],
          outreach: [],
          negotiating: [],
          under_contract: []
        }
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase pipeline row (dynamic select)
        data.forEach((item: any) => {
          // Treat 'new' as 'qualified' for the board, or move them explicitly
          const stage = item.stage === 'new' ? 'qualified' : item.stage
          if (grouped[stage]) {
            grouped[stage].push({
              ...item,
              lead: item.off_market_leads
            })
          }
        })
        
        setPipeline(grouped)
      }
      setLoading(false)
    }
    
    loadPipeline()
  }, [effectivePlan, supabase])

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return

    const { source, destination } = result

    if (source.droppableId === destination.droppableId) {
      // Reordering within the same column
      const column = [...pipeline[source.droppableId]]
      const [moved] = column.splice(source.index, 1)
      column.splice(destination.index, 0, moved)
      setPipeline({ ...pipeline, [source.droppableId]: column })
      // (Optional: update order in DB if we added an 'order' column)
    } else {
      // Moving to a new column
      const sourceCol = [...pipeline[source.droppableId]]
      const destCol = [...pipeline[destination.droppableId]]
      
      const [moved] = sourceCol.splice(source.index, 1)
      const newStage = destination.droppableId as LeadStage
      moved.stage = newStage
      
      destCol.splice(destination.index, 0, moved)
      
      setPipeline({
        ...pipeline,
        [source.droppableId]: sourceCol,
        [destination.droppableId]: destCol
      })

      // Update in Supabase
      await supabase
        .from('lead_pipeline')
        .update({ stage: newStage, updated_at: new Date().toISOString() })
        .eq('id', moved.id)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500 dark:text-slate-400">
        <Activity className="animate-spin mr-2" size={16} /> Loading Deal Desk...
      </div>
    )
  }

  if (effectivePlan !== 'expert') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center bg-white dark:bg-navy-800 border border-amber-200 dark:border-amber-800/50 rounded-xl shadow-sm">
        <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center mb-4">
          <Lock size={24} className="text-amber-500" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Upgrade to Expert for Deal Desk</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
          Deal Desk is an Expert workflow for organizing unlocked off-market opportunities by stage.
        </p>
        <Link
          href="/pricing"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
        >
          <Lock size={13} /> Compare Plans
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4 h-[calc(100vh-120px)] flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Deal Desk</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Organize and track your off-market deal pipeline.</p>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 h-full pb-2">
            {COLUMNS.map(colId => (
              <div key={colId} className="flex-shrink-0 w-[280px] flex flex-col bg-slate-100/50 dark:bg-navy-900/50 border border-slate-200/50 dark:border-white/5 rounded-xl">
                {/* Column Header */}
                <div className="px-4 py-3 border-b border-slate-200 dark:border-white/5 shrink-0 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    {LEAD_STAGE_LABELS[colId]}
                  </h3>
                  <span className="text-[10px] font-bold bg-white dark:bg-navy-800 px-2 py-0.5 rounded-full text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                    {pipeline[colId].length}
                  </span>
                </div>

                {/* Droppable Area */}
                <Droppable droppableId={colId}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`flex-1 overflow-y-auto p-2 space-y-2 transition-colors ${snapshot.isDraggingOver ? 'bg-slate-200/30 dark:bg-white/[0.02]' : ''}`}
                    >
                      {pipeline[colId].map((record, index) => (
                        <Draggable key={record.id} draggableId={record.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`bg-white dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow group
                                ${snapshot.isDragging ? 'shadow-lg border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-500/20' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <Link 
                                  href={`/dashboard/leads/intel/${record.lead_id}`}
                                  className="text-sm font-bold text-slate-900 dark:text-white leading-tight hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                                >
                                  {record.lead?.address}
                                </Link>
                                <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0
                                  ${record.lead?.deal_score && record.lead.deal_score >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50' : 
                                    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50'}`}>
                                  {record.lead?.deal_score}
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 mb-3">
                                <MapPin size={10} /> {record.lead?.city}, {record.lead?.zip_code}
                              </div>

                              <div className="flex items-center justify-between border-t border-slate-100 dark:border-white/5 pt-2">
                                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                  {record.lead?.estimated_equity ? `$${record.lead.estimated_equity.toLocaleString()}` : 'No Eq Data'}
                                </div>
                                <button className="text-[10px] text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center gap-1">
                                  <Briefcase size={10} /> Notes
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>
    </div>
  )
}
