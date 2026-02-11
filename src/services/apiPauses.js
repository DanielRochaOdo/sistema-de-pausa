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
  const { from, to, agentId, pauseTypeId } = filters
  const payload = {
    p_from: from,
    p_to: to,
    p_agent_id: agentId || null,
    p_pause_type_id: pauseTypeId || null
  }
  const { data, error } = await supabase.rpc('list_dashboard', payload)
  if (error) throw error
  return data
}