import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceRoleKey =
  Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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
    return jsonResponse(500, { error: 'Missing env vars' })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const identifier = String((body as Record<string, unknown>).identifier || '').trim()
  if (!identifier) {
    return jsonResponse(400, { error: 'Missing identifier' })
  }

  if (identifier.includes('@')) {
    return jsonResponse(200, { email: identifier })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const findByName = async (pattern: string) => {
    return adminClient
      .from('profiles')
      .select('id, email, full_name')
      .ilike('full_name', pattern)
      .limit(3)
  }

  let { data, error } = await findByName(identifier)

  if (error) {
    return jsonResponse(400, { error: error.message || 'Failed to resolve login' })
  }

  if (!data || data.length === 0) {
    if (identifier.length >= 3) {
      const fallback = await findByName(`%${identifier}%`)
      if (fallback.error) {
        return jsonResponse(400, { error: fallback.error.message || 'Failed to resolve login' })
      }
      data = fallback.data
    }
  }

  if (!data || data.length === 0) {
    return jsonResponse(404, { error: 'Nome nao encontrado' })
  }

  if (data.length > 1) {
    return jsonResponse(409, { error: 'Nome nao unico' })
  }

  const profile = data[0]
  let email = profile?.email || ''
  if (!email && profile?.id) {
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(profile.id)
    if (userError) {
      return jsonResponse(400, { error: userError.message || 'Falha ao carregar usuario' })
    }
    email = userData?.user?.email || ''
    if (email) {
      await adminClient.from('profiles').update({ email }).eq('id', profile.id)
    }
  }
  if (!email) {
    return jsonResponse(400, { error: 'Email nao cadastrado' })
  }

  return jsonResponse(200, { email })
})
