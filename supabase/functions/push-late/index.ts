import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import webpush from 'npm:web-push'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceRoleKey =
  Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:suporte@exemplo.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[push] missing Supabase env vars')
    return jsonResponse(500, { error: 'Missing Supabase env vars' })
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('[push] missing VAPID keys')
    return jsonResponse(500, { error: 'Missing VAPID keys' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (authHeader !== `Bearer ${supabaseServiceRoleKey}`) {
    console.error('[push] unauthorized request')
    return jsonResponse(401, { error: 'Unauthorized' })
  }

  let body: { pause_id?: string; manager_id?: string }
  try {
    body = await req.json()
  } catch (_) {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  const pauseId = body?.pause_id
  const managerId = body?.manager_id
  if (!pauseId || !managerId) {
    console.error('[push] missing pause_id or manager_id', body)
    return jsonResponse(400, { error: 'Missing pause_id or manager_id' })
  }

  console.info('[push] request', { pauseId, managerId })

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: pauseData, error: pauseError } = await adminClient
    .from('pauses')
    .select(
      'id, started_at, ended_at, duration_seconds, pause_types(label), profiles!pauses_agent_id_fkey(full_name)'
    )
    .eq('id', pauseId)
    .maybeSingle()

  if (pauseError || !pauseData) {
    console.error('[push] pause not found', pauseError?.message)
    return jsonResponse(404, { error: pauseError?.message || 'Pause not found' })
  }

  const { data: subscriptions, error: subsError } = await adminClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', managerId)

  if (subsError) {
    console.error('[push] failed to load subscriptions', subsError.message)
    return jsonResponse(400, { error: subsError.message || 'Failed to load subscriptions' })
  }

  if (!subscriptions?.length) {
    console.info('[push] no subscriptions for manager', managerId)
    return jsonResponse(200, { delivered: 0 })
  }

  console.info('[push] subscriptions found', subscriptions.length)

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const agentName = pauseData?.profiles?.full_name || 'Agente'
  const pauseLabel = pauseData?.pause_types?.label || 'Pausa'
  const isActive = !pauseData?.ended_at
  const durationSeconds =
    pauseData?.duration_seconds ??
    (pauseData?.started_at ? Math.max(0, Math.floor((Date.now() - new Date(pauseData.started_at).getTime()) / 1000)) : 0)
  const endedAt = pauseData?.ended_at ? new Date(pauseData.ended_at).toLocaleString('pt-BR') : ''

  const payload = JSON.stringify({
    title: isActive ? 'Pausa atrasada em andamento' : 'Pausa atrasada finalizada',
    body: `${agentName} - ${pauseLabel} • ${durationSeconds}s${endedAt ? ` • ${endedAt}` : ''}`,
    url: '/manager',
    icon: '/logo-odontoart.png',
    badge: '/logo-odontoart.png',
    tag: `pause-${pauseId}`
  })

  let delivered = 0
  let failed = 0
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        payload
      )
      delivered += 1
    } catch (err) {
      const status = err?.statusCode || err?.status || null
      failed += 1
      console.error('[push] send failed', {
        status,
        endpoint: subscription.endpoint,
        error: String(err?.message || err)
      })
      if (status === 404 || status === 410) {
        await adminClient
          .from('push_subscriptions')
          .delete()
          .eq('user_id', managerId)
          .eq('endpoint', subscription.endpoint)
      }
    }
  }

  console.info('[push] delivered', { delivered, failed })
  return jsonResponse(200, { delivered, failed })
})
