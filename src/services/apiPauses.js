import { supabase } from './supabaseClient'

export async function getPauseTypes(onlyActive = true) {
  let query = supabase.from('pause_types').select('*').order('label', { ascending: true })
  if (onlyActive) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getActivePause(agentId) {
  const { data, error } = await supabase
    .from('pauses')
    .select('id, started_at, notes, pause_type_id, pause_types(code,label)')
    .eq('agent_id', agentId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listRecentPauses(agentId, days = 7) {
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - days)
  const { data, error } = await supabase
    .from('pauses')
    .select('id, started_at, ended_at, duration_seconds, notes, pause_types(code,label)')
    .eq('agent_id', agentId)
    .gte('started_at', fromDate.toISOString())
    .order('started_at', { ascending: false })
  if (error) throw error
  return data
}

export async function startPause(pauseCode) {
  const { data, error } = await supabase.rpc('start_pause', { pause_code: pauseCode })
  if (error) throw error
  return data
}

export async function endPause(notes) {
  const { data, error } = await supabase.rpc('end_pause', { p_notes: notes ?? null })
  if (error) throw error
  return data
}

export async function listDashboard(filters) {
  const { from, to, agentId, pauseTypeId, sectorId } = filters
  const payload = {
    p_from: from,
    p_to: to,
    p_agent_id: agentId || null,
    p_pause_type_id: pauseTypeId || null,
    p_team_id: sectorId || null
  }
  const { data, error } = await supabase.rpc('list_dashboard', payload)
  if (error) throw error
  return data
}

export async function getLatePausesSummary({ fromDate, limit = 5 } = {}) {
  const payload = {
    p_from: fromDate ? fromDate.toISOString() : null,
    p_limit: limit
  }
  const { data, error } = await supabase.rpc('list_late_pauses', payload)
  if (error) throw error
  const items = data || []
  const count = items.length ? items[0].total_unread : 0
  return { items, count }
}

export async function markLatePauseAsRead(pauseId, managerId) {
  if (!pauseId || !managerId) throw new Error('Missing pauseId or managerId')
  const { data, error } = await supabase.from('pause_notifications').upsert(
    {
      pause_id: pauseId,
      manager_id: managerId,
      read_at: new Date().toISOString()
    },
    { onConflict: 'pause_id,manager_id' }
  )
  if (error) throw error
  return data
}

export async function markAllLatePausesAsRead({ fromDate } = {}) {
  const payload = {
    p_from: fromDate ? fromDate.toISOString() : null
  }
  const { data, error } = await supabase.rpc('mark_late_pauses_as_read', payload)
  if (error) throw error
  return data
}

export async function listPauseSchedules(agentId) {
  let query = supabase
    .from('pause_schedules')
    .select('id, agent_id, pause_type_id, scheduled_time, duration_minutes, profiles(full_name), pause_types(label)')
    .order('scheduled_time', { ascending: true })
  if (agentId) {
    query = query.eq('agent_id', agentId)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function listActivePauses() {
  const { data, error } = await supabase
    .from('pauses')
    .select('id, agent_id, started_at, pause_type_id, profiles(full_name, role), pause_types(label, limit_minutes)')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
  if (error) throw error
  return (data || []).filter((row) => row.profiles?.role === 'AGENTE')
}

export async function upsertPauseSchedule(payload) {
  const { data, error } = await supabase
    .from('pause_schedules')
    .upsert(payload, { onConflict: 'agent_id,pause_type_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePauseSchedule(id) {
  const { error } = await supabase.from('pause_schedules').delete().eq('id', id)
  if (error) throw error
}
