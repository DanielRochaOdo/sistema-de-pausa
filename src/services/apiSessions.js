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

export async function forceLogoutSessionsByUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error('Selecione ao menos um usuario.')
  }
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('user_sessions')
    .update({ logout_at: nowIso })
    .in('user_id', userIds)
    .is('logout_at', null)
    .select('id')
  if (error) throw error
  return (data || []).length
}

export async function forceLogoutAllSessions() {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('user_sessions')
    .update({ logout_at: nowIso })
    .is('logout_at', null)
    .select('id')
  if (error) throw error
  return (data || []).length
}
