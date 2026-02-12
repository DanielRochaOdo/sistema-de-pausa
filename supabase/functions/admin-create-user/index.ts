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

  let effectiveRole = authData.user?.app_metadata?.role

  if (!effectiveRole) {
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .single()
    if (!profileError) {
      effectiveRole = profile?.role
    }
  }

  const normalizedRole = typeof effectiveRole === 'string' ? effectiveRole.toUpperCase() : ''
  if (normalizedRole !== 'ADMIN') {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const { email, password, full_name, role, manager_id, team_id, sector_ids } =
    body as Record<string, unknown>

  if (!email || !password || !full_name || !role) {
    return jsonResponse(400, { error: 'Missing required fields' })
  }

  const allowedRoles = ['ADMIN', 'GERENTE', 'AGENTE']
  if (typeof role !== 'string' || !allowedRoles.includes(role)) {
    return jsonResponse(400, { error: 'Invalid role' })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const normalizedManagerId = typeof manager_id === 'string' && manager_id ? manager_id : null
  const providedTeamId = typeof team_id === 'string' && team_id ? team_id : null
  const providedSectorIds = Array.isArray(sector_ids)
    ? sector_ids.filter((id) => typeof id === 'string' && id)
    : []
  let resolvedTeamId = providedTeamId

  if (role === 'AGENTE') {
    if (!normalizedManagerId) {
      return jsonResponse(400, { error: 'Manager is required for agents' })
    }
    const { data: managerProfile, error: managerError } = await adminClient
      .from('profiles')
      .select('role, team_id')
      .eq('id', normalizedManagerId)
      .maybeSingle()
    if (managerError || !managerProfile) {
      return jsonResponse(400, { error: managerError?.message || 'Manager not found' })
    }
    if (managerProfile.role !== 'GERENTE') {
      return jsonResponse(400, { error: 'Manager must be GERENTE' })
    }
    const { data: managerSectors, error: managerSectorsError } = await adminClient
      .from('manager_sectors')
      .select('sector_id')
      .eq('manager_id', normalizedManagerId)
    if (managerSectorsError) {
      return jsonResponse(400, { error: managerSectorsError.message || 'Failed to load manager sectors' })
    }
    const allowedSectors = new Set([
      ...(managerSectors || []).map((row) => row.sector_id),
      managerProfile.team_id
    ].filter(Boolean))
    if (!resolvedTeamId) {
      resolvedTeamId = managerProfile.team_id ?? null
    } else if (!allowedSectors.has(resolvedTeamId)) {
      return jsonResponse(400, { error: 'Setor invalido para o gerente selecionado' })
    }
  }

  if (role === 'GERENTE') {
    if (normalizedManagerId) {
      return jsonResponse(400, { error: 'Gerente nao pode ter gerente' })
    }
    if (!resolvedTeamId && providedSectorIds.length) {
      resolvedTeamId = providedSectorIds[0]
    }
    if (!resolvedTeamId && !providedSectorIds.length) {
      return jsonResponse(400, { error: 'Gerente precisa de setor' })
    }
  }

  if (role === 'ADMIN') {
    resolvedTeamId = null
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: String(email),
    password: String(password),
    email_confirm: true,
    user_metadata: { full_name: String(full_name) },
    app_metadata: { role }
  })

  if (createError || !created?.user) {
    return jsonResponse(400, {
      error: createError?.message || 'Failed to create user',
      code: createError?.code || null,
      status: createError?.status || null
    })
  }

  const { error: insertError } = await adminClient.from('profiles').upsert(
    {
      id: created.user.id,
      email: created.user.email,
      full_name: String(full_name),
      role,
      manager_id: role === 'AGENTE' ? normalizedManagerId : null,
      team_id: resolvedTeamId
    },
    { onConflict: 'id' }
  )

  if (insertError) {
    return jsonResponse(400, {
      error: insertError.message || 'Failed to create profile',
      code: insertError.code || null
    })
  }

  if (role === 'GERENTE') {
    const uniqueSectorIds = Array.from(
      new Set([resolvedTeamId, ...providedSectorIds].filter(Boolean))
    )
    if (uniqueSectorIds.length) {
      const rows = uniqueSectorIds.map((sectorId) => ({
        manager_id: created.user.id,
        sector_id: sectorId
      }))
      const { error: managerSectorError } = await adminClient
        .from('manager_sectors')
        .upsert(rows, { onConflict: 'manager_id,sector_id' })
      if (managerSectorError) {
        return jsonResponse(400, { error: managerSectorError.message || 'Failed to set manager sectors' })
      }
    }
  }

  return jsonResponse(200, { id: created.user.id })
})
