import { supabase } from './supabaseClient'
import { createUserWithEdgeFunction } from './apiAdmin'

const isRpcSignatureError = (error) => {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function/i.test(message) ||
    /function .* does not exist/i.test(message) ||
    /no function matches the given name and argument types/i.test(message) ||
    /schema cache/i.test(message)
  )
}

const rpcWithFallback = async (fnName, payloadCandidates) => {
  let lastError = null
  for (const payload of payloadCandidates) {
    const { data, error } = await supabase.rpc(fnName, payload)
    if (!error) return data
    lastError = error
    if (!isRpcSignatureError(error)) break
  }
  throw lastError || new Error(`Falha ao executar RPC ${fnName}`)
}

export async function listSipQueues() {
  const { data, error } = await supabase
    .from('sip_queues')
    .select('id, code, label, is_active, created_at')
    .order('label', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createSipQueue(payload) {
  const normalizedCode = String(payload?.code || '').trim().toUpperCase()
  const normalizedLabel = String(payload?.label || '').trim()
  if (!normalizedCode || !normalizedLabel) {
    throw new Error('Informe codigo e nome da fila')
  }

  const { data, error } = await supabase
    .from('sip_queues')
    .insert({ code: normalizedCode, label: normalizedLabel })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateSipQueue(queueId, updates) {
  if (!queueId) throw new Error('Fila SIP invalida')
  const payload = {}
  if (Object.prototype.hasOwnProperty.call(updates || {}, 'code')) {
    payload.code = String(updates.code || '').trim().toUpperCase()
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, 'label')) {
    payload.label = String(updates.label || '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, 'is_active')) {
    payload.is_active = !!updates.is_active
  }

  const { data, error } = await supabase
    .from('sip_queues')
    .update(payload)
    .eq('id', queueId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function listSipAgents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, sip_default_extension')
    .eq('role', 'AGENTE_SIP')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function listSipQueueLinks() {
  const { data, error } = await supabase
    .from('sip_queue_agents')
    .select('queue_id, agent_id')
  if (error) throw error
  return data || []
}

export async function setSipAgentQueues(agentId, queueIds) {
  if (!agentId) throw new Error('Agente SIP invalido')
  const ids = Array.from(new Set((queueIds || []).filter(Boolean)))
  if (!ids.length) throw new Error('Selecione ao menos uma fila para o agente SIP')

  const { error: deleteError } = await supabase
    .from('sip_queue_agents')
    .delete()
    .eq('agent_id', agentId)

  if (deleteError) throw deleteError

  const rows = ids.map((queueId) => ({ agent_id: agentId, queue_id: queueId }))
  const { error: insertError } = await supabase.from('sip_queue_agents').insert(rows)
  if (insertError) throw insertError
}

export async function createSipAgent(payload) {
  const queueIds = Array.from(new Set((payload?.queue_ids || []).filter(Boolean)))
  if (!queueIds.length) {
    throw new Error('Agente SIP precisa estar em pelo menos uma fila')
  }

  return createUserWithEdgeFunction({
    email: payload?.email,
    password: payload?.password,
    full_name: payload?.full_name,
    role: 'AGENTE_SIP',
    sip_queue_ids: queueIds,
    sip_default_extension: payload?.sip_default_extension || null
  })
}

export async function createSipManager(payload) {
  return createUserWithEdgeFunction({
    email: payload?.email,
    password: payload?.password,
    full_name: payload?.full_name,
    role: 'GESTOR_SIP'
  })
}

export async function startSipSession(extension, deviceInfo = null) {
  const normalizedExtension = String(extension || '').trim()
  if (!normalizedExtension) throw new Error('Informe o ramal SIP')
  const { data, error } = await supabase.rpc('sip_start_session', {
    p_extension: normalizedExtension,
    p_device_info: deviceInfo || null
  })
  if (error) throw error
  return data
}

export async function endSipSession() {
  const { data, error } = await supabase.rpc('sip_end_session')
  if (error) throw error
  return data
}

export async function touchSipSession() {
  const { data, error } = await supabase.rpc('sip_touch_session')
  if (error) throw error
  return data
}

export async function getSipAgentStatus(agentId) {
  if (!agentId) throw new Error('Agente SIP invalido')

  const [queueRowsResult, sessionResult, activePauseResult] = await Promise.all([
    supabase
      .from('sip_queue_agents')
      .select('queue_id, sip_queues(label, is_active)')
      .eq('agent_id', agentId),
    supabase
      .from('sip_sessions')
      .select('id, sip_extension, login_at')
      .eq('agent_id', agentId)
      .is('logout_at', null)
      .order('login_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pauses')
      .select('id, started_at')
      .eq('agent_id', agentId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ])

  if (queueRowsResult.error) throw queueRowsResult.error
  if (sessionResult.error) throw sessionResult.error
  if (activePauseResult.error) throw activePauseResult.error

  const queueNames = (queueRowsResult.data || [])
    .map((row) => row.sip_queues?.label)
    .filter(Boolean)
    .join(', ')

  const login = sessionResult.data || null
  let activeCall = null
  if (login?.sip_extension) {
    const { data: byExtension, error: byExtensionError } = await supabase
      .from('sip_calls')
      .select('id, started_at, created_at, status, ended_at')
      .or(`agent_id.eq.${agentId},sip_extension.eq.${login.sip_extension}`)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(20)
    if (byExtensionError) throw byExtensionError
    const nowMs = Date.now()
    const rows = Array.isArray(byExtension) ? byExtension : []
    const isCurrentCall = (row) => {
      const status = String(row?.status || '').toUpperCase()
      if (status === 'ACTIVE') return true
      const startedMs = new Date(row?.started_at || row?.created_at || 0).getTime()
      if (!Number.isFinite(startedMs) || startedMs <= 0) return false
      return nowMs - startedMs <= 120000
    }
    activeCall = rows.find((row) => isCurrentCall(row)) || null
  } else {
    const { data: byAgent, error: byAgentError } = await supabase
      .from('sip_calls')
      .select('id, started_at, created_at, status, ended_at')
      .eq('agent_id', agentId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(20)
    if (byAgentError) throw byAgentError
    const nowMs = Date.now()
    const rows = Array.isArray(byAgent) ? byAgent : []
    const isCurrentCall = (row) => {
      const status = String(row?.status || '').toUpperCase()
      if (status === 'ACTIVE') return true
      const startedMs = new Date(row?.started_at || row?.created_at || 0).getTime()
      if (!Number.isFinite(startedMs) || startedMs <= 0) return false
      return nowMs - startedMs <= 120000
    }
    activeCall = rows.find((row) => isCurrentCall(row)) || null
  }
  const activePause = activePauseResult.data || null

  let status = 'NAO_LOGADO'
  if (login) status = 'LIVRE'
  if (login && activePause) status = 'PAUSA'
  if (login && activeCall) status = 'OCUPADO'

  return {
    queue_names: queueNames,
    sip_extension: login?.sip_extension || null,
    login_at: login?.login_at || null,
    call_started_at: activeCall?.started_at || null,
    pause_started_at: activePause?.started_at || null,
    status
  }
}

export async function listSipAgentStatuses({ queueId = null } = {}) {
  const candidates = [{ p_queue_id: queueId || null }]
  if (queueId) {
    candidates.push({ queue_id: queueId })
  } else {
    candidates.push({})
  }

  const data = await rpcWithFallback('list_sip_agent_statuses', candidates)
  return data || []
}

export async function listSipCalls({
  queueId = null,
  phone = '',
  from = null,
  to = null,
  agentId = null,
  limit = 200
} = {}) {
  const normalizedPhone = phone ? String(phone) : null
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 200, 1000))

  const candidates = [
    {
      p_queue_id: queueId || null,
      p_phone: normalizedPhone,
      p_from: from || null,
      p_to: to || null,
      p_agent_id: agentId || null,
      p_limit: cappedLimit
    },
    {
      p_queue_id: queueId || null,
      p_phone: normalizedPhone,
      p_from: from || null,
      p_to: to || null,
      p_limit: cappedLimit
    },
    {
      queue_id: queueId || null,
      phone: normalizedPhone,
      from_at: from || null,
      to_at: to || null,
      agent_id: agentId || null,
      limit_rows: cappedLimit
    }
  ]

  const data = await rpcWithFallback('list_sip_calls', candidates)
  return data || []
}

export async function listSipRecordings({
  queueId = null,
  phone = '',
  from = null,
  to = null,
  limit = 300
} = {}) {
  let query = supabase
    .from('sip_calls')
    .select(
      'id, call_id, queue_id, agent_id, sip_extension, caller_number, callee_number, started_at, answered_at, ended_at, duration_seconds, status, metadata, profiles(full_name), sip_queues(label)'
    )
    .order('started_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 300, 1000)))

  if (queueId) query = query.eq('queue_id', queueId)
  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)

  const normalizedPhone = String(phone || '')
    .trim()
    .replace(/[%]/g, '')
    .replace(/,/g, '')
  if (normalizedPhone) {
    query = query.or(
      `caller_number.ilike.%${normalizedPhone}%,callee_number.ilike.%${normalizedPhone}%`
    )
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}
