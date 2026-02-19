import { supabase } from './supabaseClient'

export async function listAgentLogins() {
  const { data, error } = await supabase.rpc('list_agent_logins')
  if (error) throw error
  return data
}

export async function listAgentLoginHistory(agentId, { limit = 30, offset = 0 } = {}) {
  if (!agentId) throw new Error('Missing agentId')
  const { data, error } = await supabase.rpc('list_agent_login_history', {
    p_agent_id: agentId,
    p_limit: limit,
    p_offset: offset
  })
  if (error) throw error
  return data
}

export async function listActiveAgentSessions({ managerId = null, restrictToManager = false } = {}) {
  let query = supabase
    .from('user_sessions')
    .select('id, user_id, login_at, device_type, profiles(full_name, role, manager_id)')
    .is('logout_at', null)
    .order('login_at', { ascending: false })

  if (restrictToManager && managerId) {
    query = query.eq('profiles.manager_id', managerId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).filter((row) => row.profiles?.role === 'AGENTE')
}
