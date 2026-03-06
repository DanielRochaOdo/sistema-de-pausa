import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceRoleKey =
  Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const sipWebhookToken = Deno.env.get('SIP_WEBHOOK_TOKEN')
const sipWebhookSigningSecret = Deno.env.get('SIP_WEBHOOK_SIGNING_SECRET')
const sipRecordingsBucket = Deno.env.get('SIP_RECORDINGS_BUCKET') || 'sip-recordings'
const SIP_SIGNATURE_TTL_SECONDS = 300
const MAX_RECORDING_BYTES = 25 * 1024 * 1024

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sip-token, x-sip-timestamp, x-sip-signature',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

const normalizeDirection = (value: unknown) => {
  const direction = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (direction === 'INBOUND' || direction === 'OUTBOUND') return direction
  return null
}

const parseTimestamp = (value: unknown) => {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const extractBase64Data = (value: string) => {
  const trimmed = value.trim()
  const match = /^data:[^;]+;base64,(.+)$/i.exec(trimmed)
  return match ? match[1] : trimmed
}

const base64ToBytes = (input: string) => {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const pick = <T>(candidate: T | null | undefined, fallback: T | null | undefined) => {
  if (candidate === null || candidate === undefined) return fallback ?? null
  return candidate
}

const toHex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

const createHmacSha256 = async (secret: string, payload: string) => {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toHex(new Uint8Array(signature))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(500, { error: 'Missing env vars' })
  }
  if (!sipWebhookToken && !sipWebhookSigningSecret) {
    return jsonResponse(500, { error: 'Webhook authentication is not configured' })
  }

  const rawBody = await req.text()
  if (!rawBody || !rawBody.trim()) {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const signatureHeader = (req.headers.get('x-sip-signature') || '').trim().toLowerCase()
  const timestampHeader = (req.headers.get('x-sip-timestamp') || '').trim()
  const hasAnySignedHeader = !!(signatureHeader || timestampHeader)

  let signatureAuthenticated = false
  if (sipWebhookSigningSecret && hasAnySignedHeader) {
    if (!signatureHeader || !timestampHeader) {
      return jsonResponse(401, { error: 'Missing signed webhook headers' })
    }

    const sentTimestamp = Number(timestampHeader)
    if (!Number.isFinite(sentTimestamp)) {
      return jsonResponse(401, { error: 'Invalid webhook timestamp' })
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    if (Math.abs(nowSeconds - sentTimestamp) > SIP_SIGNATURE_TTL_SECONDS) {
      return jsonResponse(401, { error: 'Expired webhook timestamp' })
    }

    const expectedSignature = await createHmacSha256(
      sipWebhookSigningSecret,
      `${timestampHeader}.${rawBody}`
    )
    if (!timingSafeEqual(signatureHeader, expectedSignature)) {
      return jsonResponse(401, { error: 'Invalid webhook signature' })
    }
    signatureAuthenticated = true
  }

  let tokenAuthenticated = false
  if (sipWebhookToken) {
    const headerToken = (req.headers.get('x-sip-token') || '').trim()
    const bearer = req.headers.get('Authorization') || ''
    const bearerToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : ''
    const tokenMatchesHeader = headerToken && timingSafeEqual(headerToken, sipWebhookToken)
    const tokenMatchesBearer = bearerToken && timingSafeEqual(bearerToken, sipWebhookToken)
    tokenAuthenticated = !!(tokenMatchesHeader || tokenMatchesBearer)
  }

  if (!signatureAuthenticated && !tokenAuthenticated) {
    if (sipWebhookSigningSecret && !sipWebhookToken) {
      return jsonResponse(401, { error: 'Missing signed webhook headers' })
    }
    if (sipWebhookToken) {
      return jsonResponse(401, { error: 'Invalid webhook token' })
    }
    return jsonResponse(401, { error: 'Webhook authentication failed' })
  }

  let body: unknown = null
  try {
    body = JSON.parse(rawBody)
  } catch (_err) {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const payload = body as Record<string, unknown>
  const callId = String(payload.call_id || '').trim()
  if (!callId) {
    return jsonResponse(400, { error: 'call_id is required' })
  }

  const eventType = String(payload.event || payload.status || 'update').trim().toLowerCase()
  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  let queueId = typeof payload.queue_id === 'string' && payload.queue_id ? payload.queue_id : null
  const queueCode = typeof payload.queue_code === 'string' ? payload.queue_code.trim() : ''
  if (!queueId && queueCode) {
    const { data: queueData } = await adminClient
      .from('sip_queues')
      .select('id')
      .eq('code', queueCode)
      .maybeSingle()
    queueId = queueData?.id || null
  }

  const payloadMetadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : null

  let sipExtension =
    typeof payload.sip_extension === 'string' && payload.sip_extension.trim()
      ? payload.sip_extension.trim()
      : null
  const sipExtensionConfigured =
    typeof payload.sip_extension_configured === 'string' && payload.sip_extension_configured.trim()
      ? payload.sip_extension_configured.trim()
      : typeof payloadMetadata?.sip_extension_configured === 'string' &&
          payloadMetadata.sip_extension_configured.trim()
        ? payloadMetadata.sip_extension_configured.trim()
        : null
  const extensionCandidates = Array.from(
    new Set([sipExtension, sipExtensionConfigured].filter((value): value is string => !!value))
  )

  let agentId = typeof payload.agent_id === 'string' && payload.agent_id ? payload.agent_id : null
  if (!agentId && extensionCandidates.length) {
    let sessionQuery = adminClient
      .from('sip_sessions')
      .select('agent_id, sip_extension')
      .is('logout_at', null)
      .order('login_at', { ascending: false })
      .limit(1)
    if (extensionCandidates.length === 1) {
      sessionQuery = sessionQuery.eq('sip_extension', extensionCandidates[0])
    } else {
      sessionQuery = sessionQuery.in('sip_extension', extensionCandidates)
    }
    const { data: activeSession } = await sessionQuery.maybeSingle()
    agentId = activeSession?.agent_id || null
    if (activeSession?.sip_extension) {
      sipExtension = activeSession.sip_extension
    }
  }

  if (!agentId && extensionCandidates.length) {
    let profileQuery = adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'AGENTE_SIP')
      .limit(1)
    if (extensionCandidates.length === 1) {
      profileQuery = profileQuery.eq('sip_default_extension', extensionCandidates[0])
    } else {
      profileQuery = profileQuery.in('sip_default_extension', extensionCandidates)
    }
    const { data: byProfile } = await profileQuery.maybeSingle()
    agentId = byProfile?.id || null
  }

  if (agentId) {
    const { data: linkedQueues } = await adminClient
      .from('sip_queue_agents')
      .select('queue_id, sip_queues!inner(id, is_active)')
      .eq('agent_id', agentId)
      .eq('sip_queues.is_active', true)

    const activeQueueIds = Array.from(
      new Set((linkedQueues || []).map((row) => row.queue_id).filter(Boolean))
    )
    if (activeQueueIds.length === 1) {
      queueId = activeQueueIds[0]
    }
  }

  const startedAtInput = parseTimestamp(payload.started_at || payload.timestamp)
  const answeredAtInput = parseTimestamp(payload.answered_at)
  const endedAtInput = parseTimestamp(payload.ended_at)

  const { data: existing, error: existingError } = await adminClient
    .from('sip_calls')
    .select('id, started_at, answered_at, ended_at, duration_seconds, status, metadata')
    .eq('call_id', callId)
    .maybeSingle()

  if (existingError) {
    return jsonResponse(400, { error: existingError.message || 'Failed to load existing call' })
  }

  const nowIso = new Date().toISOString()
  const startedAt = pick(startedAtInput, existing?.started_at || (eventType === 'start' ? nowIso : null))
  const answeredAt = pick(
    answeredAtInput,
    existing?.answered_at || (eventType === 'answer' || eventType === 'start' ? nowIso : null)
  )
  const endedAt = pick(endedAtInput, existing?.ended_at || (eventType === 'end' ? nowIso : null))

  let status =
    typeof payload.status === 'string' && payload.status.trim()
      ? payload.status.trim().toUpperCase()
      : null

  if (!status) {
    if (eventType === 'ringing') status = 'RINGING'
    if (eventType === 'start') status = 'ACTIVE'
    if (eventType === 'answer') status = 'ACTIVE'
    if (eventType === 'end') status = 'ENDED'
  }

  let durationSeconds: number | null = null
  if (startedAt && endedAt) {
    const start = new Date(startedAt).getTime()
    const end = new Date(endedAt).getTime()
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationSeconds = Math.floor((end - start) / 1000)
    }
  }

  const metadata = payloadMetadata
    ? {
        ...((existing?.metadata as Record<string, unknown>) || {}),
        ...payloadMetadata
      }
    : (existing?.metadata as Record<string, unknown>) || {}

  const recordingBase64Raw =
    typeof payload.recording_base64 === 'string' ? payload.recording_base64.trim() : ''
  const recordingNameRaw =
    typeof payload.recording_filename === 'string' ? payload.recording_filename.trim() : ''
  const recordingMimeRaw =
    typeof payload.recording_mime_type === 'string' ? payload.recording_mime_type.trim() : ''

  if (recordingBase64Raw) {
    try {
      const base64Data = extractBase64Data(recordingBase64Raw)
      const recordingBytes = base64ToBytes(base64Data)
      if (recordingBytes.byteLength > MAX_RECORDING_BYTES) {
        metadata.recording_error = 'recording_too_large'
      } else {
        const extension = recordingNameRaw.toLowerCase().endsWith('.mp3') ? 'mp3' : 'bin'
        const safeFilename = recordingNameRaw || `${callId}.mp3`
        const storagePath = `${new Date().toISOString().slice(0, 10)}/${callId}-${Date.now()}-${safeFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { error: uploadError } = await adminClient.storage
          .from(sipRecordingsBucket)
          .upload(storagePath, recordingBytes, {
            upsert: true,
            contentType: recordingMimeRaw || (extension === 'mp3' ? 'audio/mpeg' : 'application/octet-stream')
          })

        if (uploadError) {
          metadata.recording_error = uploadError.message || 'recording_upload_failed'
        } else {
          const { data: publicData } = adminClient.storage
            .from(sipRecordingsBucket)
            .getPublicUrl(storagePath)
          if (publicData?.publicUrl) {
            metadata.recording_url = publicData.publicUrl
          }
          metadata.recording_bucket = sipRecordingsBucket
          metadata.recording_path = storagePath
          metadata.recording_name = safeFilename
        }
      }
    } catch (_err) {
      metadata.recording_error = 'recording_decode_failed'
    }
  }

  const upsertPayload = {
    call_id: callId,
    agent_id: agentId,
    queue_id: queueId,
    sip_extension: sipExtension,
    direction: normalizeDirection(payload.direction),
    caller_number: typeof payload.caller_number === 'string' ? payload.caller_number.trim() : null,
    callee_number: typeof payload.callee_number === 'string' ? payload.callee_number.trim() : null,
    started_at: startedAt,
    answered_at: answeredAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    status,
    metadata
  }

  const { data: saved, error: saveError } = await adminClient
    .from('sip_calls')
    .upsert(upsertPayload, { onConflict: 'call_id' })
    .select('*')
    .single()

  if (saveError) {
    return jsonResponse(400, { error: saveError.message || 'Failed to save SIP call' })
  }

  return jsonResponse(200, { call: saved })
})
