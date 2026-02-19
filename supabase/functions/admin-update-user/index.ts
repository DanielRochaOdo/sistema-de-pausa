import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
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

const normalizeEmail = (value: string) => value.trim().toLowerCase()

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(500, { error: 'Missing env vars' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Missing auth token' })
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  })

  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData?.user) {
    return jsonResponse(401, { error: 'Invalid token' })
  }

  let isAdmin = false
  const appRole = authData.user?.app_metadata?.role
  if (typeof appRole === 'string' && appRole.toUpperCase() === 'ADMIN') {
    isAdmin = true
  }

  if (!isAdmin) {
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role, is_admin')
      .eq('id', authData.user.id)
      .single()
    if (!profileError) {
      const normalizedProfileRole =
        typeof profile?.role === 'string' ? profile.role.toUpperCase() : ''
      isAdmin = normalizedProfileRole === 'ADMIN' || profile?.is_admin === true
    }
  }

  if (!isAdmin) {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const {
    user_id,
    email,
    full_name,
    role,
    manager_id,
    team_id,
    is_admin
  } = body as Record<string, unknown>

  if (!user_id || typeof user_id !== 'string') {
    return jsonResponse(400, { error: 'Missing user id' })
  }

  const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email')
  const hasFullName = Object.prototype.hasOwnProperty.call(body, 'full_name')
  const hasRole = Object.prototype.hasOwnProperty.call(body, 'role')
  const hasManagerId = Object.prototype.hasOwnProperty.call(body, 'manager_id')
  const hasTeamId = Object.prototype.hasOwnProperty.call(body, 'team_id')
  const hasIsAdmin = Object.prototype.hasOwnProperty.call(body, 'is_admin')

  if (!hasEmail && !hasFullName && !hasRole && !hasManagerId && !hasTeamId && !hasIsAdmin) {
    return jsonResponse(400, { error: 'Nenhuma alteracao enviada' })
  }

  if (hasFullName && !String(full_name || '').trim()) {
    return jsonResponse(400, { error: 'Nome completo obrigatorio' })
  }

  if (hasRole) {
    const allowedRoles = ['ADMIN', 'GERENTE', 'AGENTE']
    if (typeof role !== 'string' || !allowedRoles.includes(role)) {
      return jsonResponse(400, { error: 'Invalid role' })
    }
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  let existingUser: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null =
    null

  if (hasFullName || hasRole) {
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(
      user_id
    )
    if (userError || !userData?.user) {
      return jsonResponse(400, { error: userError?.message || 'Falha ao carregar usuario' })
    }
    existingUser = {
      user_metadata: (userData.user.user_metadata || {}) as Record<string, unknown>,
      app_metadata: (userData.user.app_metadata || {}) as Record<string, unknown>
    }
  }

  const authUpdates: Record<string, unknown> = {}
  if (hasEmail && typeof email === 'string' && email.trim()) {
    authUpdates.email = normalizeEmail(email)
    authUpdates.email_confirm = true
  }
  if (hasFullName) {
    authUpdates.user_metadata = {
      ...(existingUser?.user_metadata || {}),
      full_name: String(full_name).trim()
    }
  }
  if (hasRole) {
    authUpdates.app_metadata = {
      ...(existingUser?.app_metadata || {}),
      role: String(role)
    }
  }

  if (Object.keys(authUpdates).length) {
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
      user_id,
      authUpdates
    )
    if (authUpdateError) {
      return jsonResponse(400, {
        error: authUpdateError.message || 'Failed to update auth user',
        code: authUpdateError.code || null,
        status: authUpdateError.status || null
      })
    }
  }

  const profileUpdates: Record<string, unknown> = {}
  if (hasEmail) {
    profileUpdates.email =
      typeof email === 'string' && email.trim() ? normalizeEmail(email) : null
  }
  if (hasFullName) {
    profileUpdates.full_name = String(full_name).trim()
  }
  if (hasRole) {
    profileUpdates.role = String(role)
  }
  if (hasManagerId) {
    profileUpdates.manager_id =
      typeof manager_id === 'string' && manager_id ? manager_id : null
  }
  if (hasTeamId) {
    profileUpdates.team_id = typeof team_id === 'string' && team_id ? team_id : null
  }
  if (hasIsAdmin) {
    profileUpdates.is_admin = !!is_admin
  }

  const { data: updatedProfile, error: profileError } = await adminClient
    .from('profiles')
    .update(profileUpdates)
    .eq('id', user_id)
    .select()
    .single()

  if (profileError) {
    return jsonResponse(400, {
      error: profileError.message || 'Failed to update profile',
      code: profileError.code || null
    })
  }

  return jsonResponse(200, { profile: updatedProfile })
})
