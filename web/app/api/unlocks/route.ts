import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

type UnlockContentType = 'auction_property' | 'off_market_lead'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const svc = serviceClient()
  let {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (token) {
      const { data } = await svc.auth.getUser(token)
      user = data.user
    }
  }

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = body as {
    contentType?: string
    content_type?: string
    contentId?: string
    content_id?: string
  }
  const contentType = (parsed.contentType ?? parsed.content_type) as UnlockContentType | undefined
  const contentId = parsed.contentId ?? parsed.content_id

  if (contentType !== 'auction_property' && contentType !== 'off_market_lead') {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 })
  }
  if (!contentId || !UUID_RE.test(contentId)) {
    return NextResponse.json({ error: 'A valid contentId is required' }, { status: 400 })
  }

  const { data, error } = await svc.rpc('consume_content_unlock_for_user', {
    p_user_id: user.id,
    p_content_type: contentType,
    p_content_id: contentId,
  })

  if (error) {
    console.error('[unlocks] consume_content_unlock_for_user failed:', error)
    return NextResponse.json({ error: 'Unable to unlock content' }, { status: 500 })
  }

  const result = Array.isArray(data) ? data[0] : data
  const status = result?.unlocked ? 200 : 403

  return NextResponse.json(result ?? { unlocked: false, message: 'No unlock result' }, { status })
}
