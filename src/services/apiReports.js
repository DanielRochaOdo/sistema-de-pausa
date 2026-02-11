import { supabase } from './supabaseClient'

const parseLocalDate = (value) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export async function fetchPauses(filters) {
  const { from, to, agentId, pauseTypeId } = filters
  const fromDate = parseLocalDate(from)
  const toDate = parseLocalDate(to)
  toDate.setDate(toDate.getDate() + 1)

  let query = supabase
    .from('pauses')
    .select(
      'id, started_at, ended_at, duration_seconds, notes, pause_types(code,label), profiles!pauses_agent_id_fkey(full_name)'
    )
    .gte('started_at', fromDate.toISOString())
    .lt('started_at', toDate.toISOString())
    .order('started_at', { ascending: false })

  if (agentId) query = query.eq('agent_id', agentId)
  if (pauseTypeId) query = query.eq('pause_type_id', pauseTypeId)

  const { data, error } = await query
  if (error) throw error
  return data
}