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

  let isAdmin = false
  let requesterRole = ''
  const appRole = authData.user?.app_metadata?.role
  if (typeof appRole === 'string') {
    requesterRole = appRole.toUpperCase()
    if (requesterRole === 'ADMIN') {
      isAdmin = true
    }
  }

  if (!isAdmin || !requesterRole) {
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role, is_admin')
      .eq('id', authData.user.id)
      .single()
    if (!profileError) {
      const normalizedProfileRole =
        typeof profile?.role === 'string' ? profile.role.toUpperCase() : ''
      requesterRole = normalizedProfileRole || requesterRole
      isAdmin = normalizedProfileRole === 'ADMIN' || profile?.is_admin === true
    }
  }

  const isSipManager = requesterRole === 'GESTOR_SIP'

  if (!isAdmin && !isSipManager) {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const {
    email,
    password,
    full_name,
    role,
    manager_id,
    team_id,
    sector_ids,
    sip_queue_ids,
    sip_default_extension
  } =
    body as Record<string, unknown>

  if (!email || !password || !full_name || !role) {
    return jsonResponse(400, { error: 'Missing required fields' })
  }

  const normalizedRole = typeof role === 'string' ? role.toUpperCase() : ''
  const allowedRoles = ['ADMIN', 'GERENTE', 'AGENTE', 'GESTOR_SIP', 'AGENTE_SIP']
  if (!allowedRoles.includes(normalizedRole)) {
    return jsonResponse(400, { error: 'Invalid role' })
  }

  if (isSipManager && normalizedRole !== 'AGENTE_SIP') {
    return jsonResponse(403, { error: 'Gestor SIP pode criar apenas AGENTE_SIP' })
  }

  if (normalizedRole === 'GESTOR_SIP' && requesterRole !== 'ADMIN') {
    return jsonResponse(403, { error: 'Apenas usuarios com role ADMIN podem criar GESTOR_SIP' })
  }

  if (normalizedRole === 'AGENTE_SIP' && !['ADMIN', 'GESTOR_SIP'].includes(requesterRole)) {
    return jsonResponse(403, { error: 'Sem permissao para criar AGENTE_SIP' })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const normalizedManagerId = typeof manager_id === 'string' && manager_id ? manager_id : null
  const providedTeamId = typeof team_id === 'string' && team_id ? team_id : null
  const providedSectorIds = Array.isArray(sector_ids)
    ? sector_ids.filter((id) => typeof id === 'string' && id)
    : []
  const providedSipQueueIds = Array.isArray(sip_queue_ids)
    ? sip_queue_ids.filter((id) => typeof id === 'string' && id)
    : []
  const resolvedSipQueueIds = Array.from(new Set(providedSipQueueIds))
  const normalizedSipDefaultExtension =
    typeof sip_default_extension === 'string' && sip_default_extension.trim()
      ? sip_default_extension.trim()
      : null
  let resolvedTeamId = providedTeamId

  if (normalizedRole === 'AGENTE') {
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

  if (normalizedRole === 'GERENTE') {
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

  if (normalizedRole === 'ADMIN' || normalizedRole === 'GESTOR_SIP' || normalizedRole === 'AGENTE_SIP') {
    resolvedTeamId = null
  }

  if (normalizedRole === 'AGENTE_SIP') {
    if (!resolvedSipQueueIds.length) {
      return jsonResponse(400, { error: 'Agente SIP precisa estar em pelo menos uma fila' })
    }
    const { data: queues, error: queuesError } = await adminClient
      .from('sip_queues')
      .select('id')
      .in('id', resolvedSipQueueIds)
      .eq('is_active', true)

    if (queuesError) {
      return jsonResponse(400, { error: queuesError.message || 'Falha ao validar filas SIP' })
    }

    const foundIds = new Set((queues || []).map((row) => row.id))
    const invalidQueue = resolvedSipQueueIds.find((id) => !foundIds.has(id))
    if (invalidQueue) {
      return jsonResponse(400, { error: 'Fila SIP invalida ou inativa' })
    }
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: String(email),
    password: String(password),
    email_confirm: true,
    user_metadata: { full_name: String(full_name) },
    app_metadata: { role: normalizedRole }
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
      role: normalizedRole,
      manager_id: normalizedRole === 'AGENTE' ? normalizedManagerId : null,
      team_id: resolvedTeamId,
      sip_default_extension: normalizedRole === 'AGENTE_SIP' ? normalizedSipDefaultExtension : null
    },
    { onConflict: 'id' }
  )

  if (insertError) {
    return jsonResponse(400, {
      error: insertError.message || 'Failed to create profile',
      code: insertError.code || null
    })
  }

  if (normalizedRole === 'GERENTE') {
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

  if (normalizedRole === 'AGENTE_SIP') {
    const rows = resolvedSipQueueIds.map((queueId) => ({
      queue_id: queueId,
      agent_id: created.user.id
    }))
    const { error: sipQueueError } = await adminClient.from('sip_queue_agents').insert(rows)
    if (sipQueueError) {
      return jsonResponse(400, { error: sipQueueError.message || 'Falha ao vincular filas SIP' })
    }
  }

  return jsonResponse(200, { id: created.user.id })
})
