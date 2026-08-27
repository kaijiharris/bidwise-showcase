'use client'

import { useState, useRef } from 'react'
import Papa from 'papaparse'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/client'
import { calculateDealScore } from '@/lib/scoring'
import { Upload, X, AlertCircle, CheckCircle, Activity, FileSpreadsheet } from 'lucide-react'

type ParsedRow = Record<string, string>

// Coerce any exceljs cell value into a plain string. Worksheets can hand back
// dates, formula results, hyperlinks, and rich-text fragments — downstream
// code expects bare strings/numbers it can run regex on.
function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((r) => r.text ?? '').join('')
    }
    if (obj.result !== undefined && obj.result !== null) return String(obj.result)
    if (typeof obj.hyperlink === 'string' && typeof obj.text === 'string') return obj.text
  }
  return ''
}

function parseCsv(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => resolve(result.data),
      error: (err) => reject(err),
    })
  })
}

async function parseXlsx(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buf)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  let headers: string[] = []
  const rows: ParsedRow[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // exceljs row.values is 1-indexed with a leading undefined slot.
    const values = (row.values as ExcelJS.CellValue[]).slice(1)
    if (rowNumber === 1) {
      headers = values.map((v) => cellToString(v).trim())
      return
    }
    const obj: ParsedRow = {}
    headers.forEach((h, i) => {
      if (!h) return
      obj[h] = cellToString(values[i])
    })
    rows.push(obj)
  })
  return rows
}

export default function CsvUploadModal({
  onClose,
  onSuccess
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 25 MB / 50k rows still applies as defense in depth. exceljs has a
  // cleaner CVE history than SheetJS, but malicious xlsx (zip bombs,
  // pathological shared-string tables) can still hose the tab.
  const MAX_FILE_BYTES = 25 * 1024 * 1024   // 25 MB
  const MAX_ROWS = 50_000

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    if (!picked) return
    if (picked.size > MAX_FILE_BYTES) {
      setError(`File too large (${(picked.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`)
      setFile(null)
      return
    }
    setFile(picked)
    setError(null)
  }

  const cleanNumeric = (val: string) => {
    if (!val) return null
    const cleaned = val.replace(/[^0-9.-]+/g, '')
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? null : parsed
  }

  const handleUpload = async () => {
    if (!file) return
    setIsUploading(true)
    setError(null)
    setProgress(10)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setError("Authentication error. Please log in again.")
      setIsUploading(false)
      return
    }

    try {
      const name = file.name.toLowerCase()
      const isCsv = name.endsWith('.csv') || file.type === 'text/csv'
      const isXlsx = name.endsWith('.xlsx')
      if (!isCsv && !isXlsx) {
        throw new Error('Unsupported file type. Upload a .csv or .xlsx export.')
      }

      const rows: ParsedRow[] = isCsv ? await parseCsv(file) : await parseXlsx(file)

      setProgress(40)

      if (rows.length === 0) {
        throw new Error("The file is empty.")
      }
      if (rows.length > MAX_ROWS) {
        throw new Error(`Too many rows (${rows.length.toLocaleString()}). Split into batches of ${MAX_ROWS.toLocaleString()} or fewer.`)
      }

      const firstRow = rows[0]
      if (!firstRow['Address'] && !firstRow['Property Address']) {
        throw new Error("Could not find an 'Address' column. Ensure this is a PropStream export.")
      }

      const leadsToInsert = rows.map((row) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lead row assembled from arbitrary PropStream CSV columns
          const rawLead: any = {
            user_id: user.id,
            address: row['Address'] || row['Property Address'] || '',
            city: row['City'] || row['Property City'] || '',
            state: row['State'] || row['Property State'] || 'GA',
            zip_code: row['Zip'] || row['Property Zip'] || '',
            county: (row['County'] || '').toLowerCase().replace(' county', ''),
            
            // Core Financials
            estimated_equity: cleanNumeric(row['Est. Equity'] || row['Estimated Equity']),
            mortgage_balance: cleanNumeric(row['Est. Remaining balance of Open Loans'] || row['Estimated Mortgage Balance']),
            est_value: cleanNumeric(row['Est. Value']),
            open_liens: cleanNumeric(row['Total Open Loans'] || row['Open Liens']),
            foreclosure_status: row['Foreclosure Factor'] || row['Foreclosure Status'] || '',
            listing_status: row['MLS Status'] || '',
            
            // Owner Info
            owner_type: row['Owner Occupied'] === 'Yes' ? 'Owner Occupied' : 'Absentee Owner',
            years_owned: cleanNumeric(row['Years Owned'] || row['Length of Residence']),
            owner_name: `${row['Owner 1 First Name'] || ''} ${row['Owner 1 Last Name'] || ''}`.trim() || row['Owner 1 Type'] || '',
            owner_phone: row['Phone 1'] || '',
            owner_email: row['Email 1'] || '',
            
            // Mailing Address
            mailing_address: row['Mailing Address'] || '',
            mailing_city: row['Mailing City'] || '',
            mailing_state: row['Mailing State'] || '',
            mailing_zip: row['Mailing Zip'] || '',

            // Property Specs
            year_built: cleanNumeric(row['Effective Year Built'] || row['Year Built']),
            building_sqft: cleanNumeric(row['Building Sqft']),
            beds: cleanNumeric(row['Bedrooms']),
            baths: cleanNumeric(row['Total Bathrooms']),
            
            propstream_found: true,
            propstream_enriched_at: new Date().toISOString(),
            source: 'bidwise_upload',
            batch_id: `upload_${Date.now()}`
          }

          const { score, deal_type, signals, equity_tier } = calculateDealScore(rawLead)
          
          rawLead.deal_score = score
          rawLead.deal_type = deal_type
          rawLead.distress_signals = signals
          rawLead.equity_tier = equity_tier

          return rawLead
        }).filter(l => l.address && l.zip_code)

        setProgress(60)

        const batchSize = 100
        for (let i = 0; i < leadsToInsert.length; i += batchSize) {
          const batch = leadsToInsert.slice(i, i + batchSize)
          const { error: sbError } = await supabase
            .from('off_market_leads')
            .upsert(batch, { onConflict: 'user_id,address,zip_code' })
          
          if (sbError) throw sbError
          setProgress(60 + Math.floor((i / leadsToInsert.length) * 40))
        }

      setIsUploading(false)
      onSuccess()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to process the file.'
      setError(message)
      setIsUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-navy-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Upload size={16} className="text-emerald-500" /> Upload Deal Feed
          </h2>
          <button onClick={onClose} disabled={isUploading} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Upload your pre-filtered CSV. BidWise will automatically score the properties, extract distress signals, and add them to your pipeline feed.
          </p>

          <div className="bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-white/10 rounded-xl p-4 text-center">
            {file ? (
              <div className="flex flex-col items-center justify-center py-2">
                <FileSpreadsheet size={32} className="text-emerald-500 mb-2" />
                <span className="text-sm font-bold text-slate-800 dark:text-white">{file.name}</span>
                <span className="text-[10px] text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</span>
                {!isUploading && (
                  <button onClick={() => setFile(null)} className="text-xs text-red-500 hover:text-red-600 mt-3 font-medium">
                    Remove File
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4">
                <Upload size={24} className="text-slate-400 mb-2" />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  Click to select CSV
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept=".csv, .xlsx, .xls" 
                  className="hidden" 
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg flex gap-2 text-red-700 dark:text-red-400 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                <span>Processing & Scoring...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300" 
                  style={{ width: `${progress}%` }} 
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-navy-800 flex justify-end gap-2">
          <button 
            onClick={onClose} 
            disabled={isUploading}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {isUploading ? <><Activity size={14} className="animate-spin" /> Uploading...</> : <><CheckCircle size={14} /> Process List</>}
          </button>
        </div>
      </div>
    </div>
  )
}
