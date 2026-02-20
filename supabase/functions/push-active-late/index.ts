import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceRoleKey =
  Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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
    console.error('[push-active] missing Supabase env vars')
    return jsonResponse(500, { error: 'Missing Supabase env vars' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (authHeader !== `Bearer ${supabaseServiceRoleKey}`) {
    console.error('[push-active] unauthorized request')
    return jsonResponse(401, { error: 'Unauthorized' })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: activeRows, error: activeError } = await adminClient.rpc('list_active_late_pauses_for_push')
  if (activeError) {
    console.error('[push-active] failed to load active late pauses', activeError.message)
    return jsonResponse(400, { error: activeError.message })
  }

  const rows = (activeRows || []).filter((row) => row.pause_id && row.manager_id)
  if (!rows.length) {
    return jsonResponse(200, { inserted: 0 })
  }

  const { error: insertError } = await adminClient
    .from('pause_notifications')
    .upsert(
      rows.map((row) => ({ pause_id: row.pause_id, manager_id: row.manager_id })),
      { onConflict: 'pause_id,manager_id', ignoreDuplicates: true }
    )

  if (insertError) {
    console.error('[push-active] failed to insert notifications', insertError.message)
    return jsonResponse(400, { error: insertError.message })
  }

  return jsonResponse(200, { inserted: rows.length })
})
