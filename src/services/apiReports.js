import { supabase } from './supabaseClient'

const parseLocalDate = (value) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export async function fetchPauses(filters) {
  const { from, to, agentId, pauseTypeId, sectorId, agentIds } = filters
  const fromDate = parseLocalDate(from)
  const toDate = parseLocalDate(to)
  toDate.setDate(toDate.getDate() + 1)

  if (Array.isArray(agentIds) && agentIds.length === 0) {
    return []
  }

  let query = supabase
    .from('pauses')
    .select(
      'id, agent_id, pause_type_id, started_at, ended_at, duration_seconds, atraso, pause_types(code,label,limit_minutes,tolerance_start_minutes,tolerance_end_minutes), profiles!pauses_agent_id_fkey(full_name, team_id)'
    )
    .gte('started_at', fromDate.toISOString())
    .lt('started_at', toDate.toISOString())
    .order('started_at', { ascending: false })

  if (agentId) {
    query = query.eq('agent_id', agentId)
  } else if (Array.isArray(agentIds) && agentIds.length) {
    query = query.in('agent_id', agentIds)
  }
  if (pauseTypeId) query = query.eq('pause_type_id', pauseTypeId)
  if (sectorId) query = query.eq('profiles.team_id', sectorId)

  const { data, error } = await query
  if (error) throw error
  return data
}
